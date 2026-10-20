import { randomUUID } from 'node:crypto';
import { createAdapter } from '@gateway/core';
import type { CLIAdapter } from '@gateway/core';
import {
  UnifiedStreamEventSchema,
  createStreamEvent,
  type FrontendContextPayload,
  type PromptRequest,
  type ProviderType,
  type UnifiedStreamEvent,
} from '@gateway/shared-types';

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

const HEALTH_TIMEOUT_MS = 1_000;
const KILL_RETRY_MS = 1_000;

export interface DevtoolsPromptInput {
  provider: ProviderType;
  prompt: string;
  cwd: string;
  files?: string[];
  context?: FrontendContextPayload;
  yolo?: boolean;
  ephemeral?: boolean;
  sessionId?: string;
}

export interface PromptSession {
  sessionId: string;
  cancel(): Promise<void>;
}

export interface PromptRunner {
  start(input: DevtoolsPromptInput, onEvent: (event: UnifiedStreamEvent) => void): Promise<PromptSession>;
}

export interface PromptRunnerOptions {
  gatewayUrl?: string;
  fetchImpl?: typeof fetch;
  createAdapter?: (provider: ProviderType) => CLIAdapter;
  onFallback?: (gatewayUrl: string, provider: ProviderType) => void;
}

interface EventSink {
  emit(event: UnifiedStreamEvent): void;
  readonly closed: boolean;
}

/**
 * Prefer the gateway HTTP API. When it is down, run the provider through
 * `@gateway/core` in this process so the overlay still receives stream events.
 */
export function createPromptRunner(options: PromptRunnerOptions = {}): PromptRunner {
  const gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const adapterFor = options.createAdapter ?? ((provider: ProviderType) => createAdapter(provider));
  let warned = false;

  return {
    async start(input, onEvent) {
      const sink = createSink(onEvent);
      try {
        if (await gatewayReachable(gatewayUrl, fetchImpl)) {
          return await startViaGateway(gatewayUrl, fetchImpl, input, sink);
        }
        if (!warned) {
          warned = true;
          options.onFallback?.(gatewayUrl, input.provider);
        }
        return await startViaCore(adapterFor, input, sink);
      } catch (error) {
        if (!sink.closed && !isAbort(error)) {
          const sessionId = input.sessionId ?? 'error';
          sink.emit(createStreamEvent(sessionId, 'error', { error: messageOf(error) }));
          sink.emit(createStreamEvent(sessionId, 'done', {}));
        }
        return {
          sessionId: input.sessionId ?? 'error',
          async cancel() {},
        };
      }
    },
  };
}

export function composePrompt(prompt: string, context?: FrontendContextPayload): string {
  if (!context) return prompt;
  const summary = {
    selectedElement: context.selectedElement,
    recentErrors: context.recentErrors.slice(-10),
    recentConsoleLogs: context.recentConsoleLogs.slice(-10),
    failedNetworkRequests: context.failedNetworkRequests.slice(-10),
    screenshotIncluded: Boolean(context.screenshotBase64),
  };
  return `${prompt}\n\n<frontend_context>\n${JSON.stringify(summary, null, 2)}\n</frontend_context>`;
}

/** Pull complete SSE frames out of a streaming buffer. The return value is the remainder. */
export function consumeSseBuffer(buffer: string, onEvent: (event: UnifiedStreamEvent) => void): string {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const data = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      const parsed = UnifiedStreamEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // Incomplete or non-JSON frames are ignored; a later chunk may finish them.
    }
  }
  return rest;
}

function createSink(onEvent: (event: UnifiedStreamEvent) => void): EventSink {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    emit(event) {
      if (closed) return;
      if (event.type === 'done') closed = true;
      onEvent(event);
    },
  };
}

async function gatewayReachable(gatewayUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(new URL('/health', `${gatewayUrl}/`), { signal: controller.signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function startViaGateway(
  gatewayUrl: string,
  fetchImpl: typeof fetch,
  input: DevtoolsPromptInput,
  sink: EventSink,
): Promise<PromptSession> {
  const controller = new AbortController();
  const response = await fetchImpl(new URL('/api/v1/sessions', `${gatewayUrl}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(promptRequest(input)),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const created = (await response.json()) as { sessionId?: string; streamUrl?: string };
  if (!created.sessionId || !created.streamUrl) {
    throw new Error('Gateway did not return a session stream');
  }
  const sessionId = created.sessionId;
  void readGatewayStream(
    fetchImpl,
    new URL(created.streamUrl, `${gatewayUrl}/`),
    controller.signal,
    sessionId,
    sink,
  );

  return {
    sessionId,
    async cancel() {
      controller.abort();
      await fetchImpl(new URL(`/api/v1/sessions/${sessionId}`, `${gatewayUrl}/`), {
        method: 'DELETE',
      }).catch(() => undefined);
    },
  };
}

async function readGatewayStream(
  fetchImpl: typeof fetch,
  url: URL,
  signal: AbortSignal,
  sessionId: string,
  sink: EventSink,
): Promise<void> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/event-stream' },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(await readError(response));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawEvent = false;
    const onEvent = (event: UnifiedStreamEvent): void => {
      sawEvent = true;
      sink.emit(event);
    };
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, onEvent);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeSseBuffer(`${buffer}\n\n`, onEvent);
    } finally {
      reader.releaseLock();
    }
    if (!sink.closed && !signal.aborted) {
      if (!sawEvent) {
        sink.emit(createStreamEvent(sessionId, 'error', { error: 'Gateway stream ended without events' }));
      }
      sink.emit(createStreamEvent(sessionId, 'done', {}));
    }
  } catch (error) {
    if (signal.aborted || isAbort(error) || sink.closed) return;
    sink.emit(createStreamEvent(sessionId, 'error', { error: messageOf(error) }));
    sink.emit(createStreamEvent(sessionId, 'done', {}));
  }
}

async function startViaCore(
  adapterFor: (provider: ProviderType) => CLIAdapter,
  input: DevtoolsPromptInput,
  sink: EventSink,
): Promise<PromptSession> {
  const sessionId = input.sessionId ?? `sess_${randomUUID()}`;
  const adapter = adapterFor(input.provider);
  const request = promptRequest(input);
  void adapter
    .execute(
      {
        prompt: request.prompt,
        cwd: request.cwd,
        sessionId,
        yolo: request.yolo,
        ...(request.files !== undefined ? { files: request.files } : {}),
        ...(request.ephemeral !== undefined ? { ephemeral: request.ephemeral } : {}),
      },
      (event) => sink.emit(event),
    )
    .catch((error: unknown) => {
      if (sink.closed || isAbort(error)) return;
      sink.emit(createStreamEvent(sessionId, 'error', { error: messageOf(error) }));
      sink.emit(createStreamEvent(sessionId, 'done', {}));
    });

  return {
    sessionId,
    async cancel() {
      const deadline = Date.now() + KILL_RETRY_MS;
      for (;;) {
        if (await adapter.kill(sessionId)) return;
        if (Date.now() >= deadline) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    },
  };
}

function promptRequest(input: DevtoolsPromptInput): PromptRequest {
  return {
    provider: input.provider,
    cwd: input.cwd,
    prompt: composePrompt(input.prompt, input.context),
    yolo: input.yolo ?? true,
    ...(input.files !== undefined ? { files: input.files } : {}),
    ...(input.ephemeral !== undefined ? { ephemeral: input.ephemeral } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    // The body is plain text.
  }
  return text.trim() || `Gateway responded ${response.status}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Prompt failed';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
