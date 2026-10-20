import {
  GatewayClientMessageSchema,
  GatewayServerMessageSchema,
  UnifiedStreamEventSchema,
  type FrontendContextPayload,
  type GatewayClientMessage,
  type ProviderType,
  type UnifiedStreamEvent,
} from '@gateway/shared-types';
import {
  DEFAULT_GATEWAY_URL,
  type GatewayBridge,
  type GatewayTransportMode,
  type StreamPromptInput,
} from '../types.js';

const HEALTH_TIMEOUT_MS = 2_000;

export class GatewayCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'GatewayCancelledError';
  }
}

export interface GatewayClientOptions {
  gatewayUrl?: string;
  cwd?: string;
  transport?: GatewayTransportMode;
}

export function gatewayWebSocketUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
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

export function buildPromptMessage(input: {
  provider: ProviderType;
  cwd: string;
  prompt: string;
  context?: FrontendContextPayload;
}): GatewayClientMessage {
  return GatewayClientMessageSchema.parse({
    type: 'prompt',
    provider: input.provider,
    cwd: input.cwd,
    prompt: composePrompt(input.prompt, input.context),
    yolo: true,
    ...(input.context ? { context: input.context } : {}),
  });
}

/**
 * Parse complete SSE frames from a streaming buffer.
 * The gateway writes `event: <type>` and `data: <UnifiedStreamEvent JSON>`.
 * The returned string is the trailing incomplete frame.
 */
export function consumeSseBuffer(buffer: string, input: StreamPromptInput): string {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) dispatchSseBlock(part, input);
  return rest;
}

export class GatewayClient implements GatewayBridge {
  private readonly gatewayUrl: string;
  private readonly cwd: string;
  private readonly transport: GatewayTransportMode;
  private socket: WebSocket | null = null;
  private abort: AbortController | null = null;
  private sessionId: string | undefined;
  private rejectActive: ((error: Error) => void) | null = null;
  private cancelled = false;

  constructor(options: GatewayClientOptions = {}) {
    this.gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    this.cwd = options.cwd && options.cwd.trim() ? options.cwd : '.';
    this.transport = options.transport ?? 'auto';
  }

  async checkHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(new URL('/health', `${this.gatewayUrl}/`), {
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { status?: string };
      return body.status === 'ok';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  cancel(): void {
    this.cancelled = true;
    const sessionId = this.sessionId;
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN && sessionId) {
      socket.send(JSON.stringify({ type: 'cancel', sessionId }));
    }
    this.abort?.abort();
    socket?.close();
    this.socket = null;
    this.sessionId = undefined;
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject?.(new GatewayCancelledError());
  }

  async streamPrompt(input: StreamPromptInput): Promise<void> {
    this.cancelled = false;
    const message = buildPromptMessage({
      provider: input.provider,
      cwd: input.cwd?.trim() || this.cwd,
      prompt: input.prompt,
      ...(input.context ? { context: input.context } : {}),
    });
    if (message.type !== 'prompt') throw new Error('Expected a prompt message');
    if (this.transport === 'sse') {
      await this.streamOverSse(message, input);
      return;
    }
    try {
      await this.streamOverWebSocket(message, input);
    } catch (error) {
      if (error instanceof GatewayCancelledError || this.cancelled) {
        throw error instanceof GatewayCancelledError ? error : new GatewayCancelledError();
      }
      if (this.transport === 'websocket') throw describeGatewayError(error, this.gatewayUrl);
      try {
        await this.streamOverSse(message, input);
      } catch (sseError) {
        if (sseError instanceof GatewayCancelledError || this.cancelled) {
          throw sseError instanceof GatewayCancelledError ? sseError : new GatewayCancelledError();
        }
        throw describeGatewayError(sseError, this.gatewayUrl);
      }
    }
  }

  private streamOverWebSocket(
    message: GatewayClientMessage,
    input: StreamPromptInput,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;
      let notified = false;
      const notifyDone = (): void => {
        if (notified) return;
        notified = true;
        input.onDone?.();
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        this.rejectActive = null;
        this.socket = null;
        if (error) reject(error);
        else resolve();
      };
      this.rejectActive = (error) => finish(error);

      let socket: WebSocket;
      try {
        socket = new WebSocket(gatewayWebSocketUrl(this.gatewayUrl));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('WebSocket failed'));
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        opened = true;
        socket.send(JSON.stringify(message));
      };
      socket.onerror = () => {
        if (!opened) finish(new Error('Gateway WebSocket connection failed'));
      };
      socket.onmessage = (event) => {
        this.handleServerMessage(String(event.data), input, notifyDone, () => finish());
      };
      socket.onclose = () => {
        if (settled) return;
        if (this.cancelled) {
          finish(new GatewayCancelledError());
          return;
        }
        if (opened) notifyDone();
        finish(opened ? undefined : new Error('Gateway WebSocket connection failed'));
      };
    });
  }

  private async streamOverSse(
    message: Extract<GatewayClientMessage, { type: 'prompt' }>,
    input: StreamPromptInput,
  ): Promise<void> {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      const created = await fetch(new URL('/api/v1/sessions', `${this.gatewayUrl}/`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: message.provider,
          cwd: message.cwd,
          prompt: message.prompt,
          yolo: true,
        }),
        signal,
      });
      if (!created.ok) {
        const text = await created.text();
        throw new Error(text || `Gateway responded ${created.status}`);
      }
      const body = (await created.json()) as { streamUrl?: string };
      if (!body.streamUrl) throw new Error('Gateway did not return a stream URL');
      const stream = await fetch(new URL(body.streamUrl, `${this.gatewayUrl}/`), {
        headers: { accept: 'text/event-stream' },
        signal,
      });
      if (!stream.ok || !stream.body) throw new Error(`Stream failed (${stream.status})`);
      await readSse(stream.body, input);
    } catch (error) {
      if (this.cancelled || isAbortError(error)) throw new GatewayCancelledError();
      throw error;
    }
  }

  private handleServerMessage(
    raw: string,
    input: StreamPromptInput,
    notifyDone: () => void,
    done: () => void,
  ): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      input.onError?.('Invalid gateway message');
      return;
    }
    const parsed = GatewayServerMessageSchema.safeParse(payload);
    if (!parsed.success) {
      input.onError?.('Unrecognized gateway message');
      return;
    }
    const message = parsed.data;
    if (message.type === 'ready') {
      this.sessionId = message.sessionId;
      return;
    }
    if (message.type === 'error') {
      input.onError?.(message.message);
      notifyDone();
      this.socket?.close();
      done();
      return;
    }
    applyStreamEvent(message.event, input, () => {
      this.sessionId = undefined;
      notifyDone();
      this.socket?.close();
      done();
    });
  }
}

async function readSse(body: ReadableStream<Uint8Array>, input: StreamPromptInput): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let notified = false;
  const once: StreamPromptInput = {
    ...input,
    onDone() {
      if (notified) return;
      notified = true;
      input.onDone?.();
    },
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, once);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeSseBuffer(`${buffer}\n\n`, once);
  once.onDone?.();
}

function dispatchSseBlock(block: string, input: StreamPromptInput): void {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  try {
    const parsed = UnifiedStreamEventSchema.safeParse(JSON.parse(dataLines.join('\n')));
    if (!parsed.success) {
      input.onError?.('Unrecognized gateway event');
      return;
    }
    applyStreamEvent(parsed.data, input, () => {
      input.onDone?.();
    });
  } catch {
    input.onError?.('Invalid gateway event');
  }
}

function applyStreamEvent(
  event: UnifiedStreamEvent,
  input: StreamPromptInput,
  onTerminal: () => void,
): void {
  if (event.type === 'chunk' && event.payload.text) input.onChunk?.(event.payload.text);
  if (event.type === 'file_edit') input.onFileEdit?.(event.payload.filePath ?? '');
  if (event.type === 'error') input.onError?.(event.payload.error ?? 'The agent reported an error');
  if (event.type === 'done' || event.type === 'error') onTerminal();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function describeGatewayError(error: unknown, gatewayUrl: string): Error {
  const message = error instanceof Error ? error.message : 'Prompt failed';
  if (
    message === 'Failed to fetch' ||
    message.includes('WebSocket') ||
    message.includes('NetworkError') ||
    message.includes('Load failed')
  ) {
    return new Error(`Could not reach the gateway at ${gatewayUrl}`);
  }
  return error instanceof Error ? error : new Error(message);
}
