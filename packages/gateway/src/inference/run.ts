import type {
  ImageAttachment,
  InferRequest,
  InferResponse,
  PromptRequest,
  ProviderCapabilities,
  ProviderType,
  ThreadSource,
  UnifiedStreamEvent,
} from '@aidev/protocol';
import type { FastifyReply } from 'fastify';
import type { Principal } from '../auth/principal.js';
import { abortThreadRun, executionHttpError, startExecution } from '../execute.js';
import { HttpError } from '../errors.js';
import { formatSse, sseHeaders } from '../sse.js';
import { newRunId, runningRun, threadTitle, type ThreadRunBinding } from '../threads/run.js';
import type { ServerDeps } from '../types.js';
import { imagePromptNote, writeInferImages } from './images.js';
import { renderInferPrompt, retryPrompt, schemaSystemInstruction } from './messages.js';
import { createScratch, removeScratch } from './scratch.js';
import { checkStructuredOutput } from './structured.js';

export interface InferSetup {
  provider: ProviderType;
  model: string;
  keep: boolean;
  scratch: string;
  threadId: string;
  runId: string;
  startedAt: number;
  rendered: ReturnType<typeof renderInferPrompt>;
  nativeSchema: boolean;
  attachments: ImageAttachment[];
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
}

export type InferComplete =
  | { kind: 'ok'; response: InferResponse }
  | { kind: 'structured_error'; raw: string; issues: unknown };

export interface InferStreamSink {
  open(): void;
  delta(text: string): void;
  done(response: InferResponse): void;
  error(error: HttpError): void;
  close(): void;
}

export async function beginInfer(
  deps: ServerDeps,
  body: InferRequest,
  source: ThreadSource,
): Promise<InferSetup> {
  const { provider, supportsJsonSchema } = await resolveInferProvider(deps, body.provider);
  const model = body.model ?? deps.config.defaultModel;
  const keep = body.keep === true;
  const jsonSchema = body.jsonSchema;
  const images = body.images ?? [];
  const messages = ensureUserText(body.messages, images.length > 0);
  const renderedBase = renderInferPrompt(
    messages,
    body.system,
    jsonSchema ? schemaSystemInstruction(jsonSchema) : undefined,
  );
  const runId = newRunId();
  const scratch = await createScratch(deps.home, runId);
  try {
    const written = await writeInferImages({
      home: deps.home,
      scratch,
      runId,
      images,
      keep,
    });
    const note = imagePromptNote(written.promptPaths);
    const rendered = note
      ? { ...renderedBase, prompt: `${renderedBase.prompt}\n\n${note}` }
      : renderedBase;
    const thread = await deps.threads.createThread({
      projectId: null,
      provider,
      model: model ?? null,
      mode: 'ask',
      title: threadTitle(rendered.instruction),
      keep,
      source,
    });
    const run = runningRun({
      threadId: thread.id,
      prompt: rendered.instruction,
      contextSummary: null,
      attachments: written.attachments,
      id: runId,
    });
    await deps.threads.updateRun(thread.id, run);
    return {
      provider,
      model: model ?? '',
      keep,
      scratch,
      threadId: thread.id,
      runId,
      startedAt: run.startedAt,
      rendered,
      nativeSchema: supportsJsonSchema,
      attachments: written.attachments,
      ...(jsonSchema ? { jsonSchema } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
    };
  } catch (error) {
    await removeScratch(scratch);
    throw error;
  }
}

export async function cleanupInfer(setup: InferSetup): Promise<void> {
  if (!setup.keep) await removeScratch(setup.scratch);
}

export async function completeInfer(
  deps: ServerDeps,
  principal: Principal,
  setup: InferSetup,
): Promise<InferComplete> {
  let prompt = setup.rendered.prompt;
  let lastRaw = '';
  let lastIssues: unknown = [];
  const attempts = setup.jsonSchema ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt === 1 && setup.jsonSchema) {
      prompt = retryPrompt(setup.rendered.prompt, lastIssues, setup.jsonSchema);
    }
    const binding = await bindingForAttempt(deps, setup, attempt, prompt);
    const outcome = await executeOnce(deps, principal, setup, prompt, binding);
    if (outcome.error) throw executionHttpError(outcome.error);
    lastRaw = collectAssistantText(outcome.events);
    if (!setup.jsonSchema) {
      return { kind: 'ok', response: toResponse(setup, binding.runId, lastRaw, outcome.events) };
    }
    const check = checkStructuredOutput(setup.jsonSchema, lastRaw);
    if (check.ok) {
      return {
        kind: 'ok',
        response: { ...toResponse(setup, binding.runId, lastRaw, outcome.events), object: check.value },
      };
    }
    lastIssues = check.issues;
  }
  return { kind: 'structured_error', raw: lastRaw, issues: lastIssues };
}

export async function streamInfer(
  deps: ServerDeps,
  principal: Principal,
  setup: InferSetup,
  sink: InferStreamSink,
): Promise<void> {
  const binding = await bindingForAttempt(deps, setup, 0, setup.rendered.prompt);
  const { sessionId, done } = await startOnce(deps, principal, setup, setup.rendered.prompt, binding);
  sink.open();

  const writeDelta = (event: UnifiedStreamEvent): void => {
    if (!isAssistantChunk(event) || !event.payload.text) return;
    try {
      sink.delta(event.payload.text);
    } catch {
      // The client left. The run still finishes and the scratch dir is removed.
    }
  };

  const subscription = deps.registry.subscribe(sessionId, writeDelta);
  if (subscription) {
    for (const event of subscription.events) writeDelta(event);
  }

  try {
    const outcome = await done;
    subscription?.unsubscribe();
    if (outcome.error) {
      sink.error(executionHttpError(outcome.error));
    } else {
      const text = collectAssistantText(outcome.events);
      sink.done(toResponse(setup, binding.runId, text, outcome.events));
    }
  } catch (error) {
    subscription?.unsubscribe();
    try {
      sink.error(executionHttpError(error));
    } catch {
      // Socket already closed.
    }
  } finally {
    sink.close();
  }
}

export function inferSseSink(reply: FastifyReply): InferStreamSink {
  return {
    open() {
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders(reply));
    },
    delta(text) {
      reply.raw.write(formatSse('delta', { text }));
    },
    done(response) {
      reply.raw.write(
        formatSse('done', {
          id: response.id,
          text: response.text,
          durationMs: response.durationMs,
          ...(response.object !== undefined ? { object: response.object } : {}),
        }),
      );
    },
    error(error) {
      reply.raw.write(formatSse('error', errorPayload(error)));
    },
    close() {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        try {
          reply.raw.end();
        } catch {
          // Already gone.
        }
      }
    },
  };
}

export function writeBufferedInferSse(reply: FastifyReply, response: InferResponse): void {
  const sink = inferSseSink(reply);
  sink.open();
  try {
    if (response.text) sink.delta(response.text);
    sink.done(response);
  } finally {
    sink.close();
  }
}

async function executeOnce(
  deps: ServerDeps,
  principal: Principal,
  setup: InferSetup,
  prompt: string,
  binding: ThreadRunBinding,
) {
  const { done } = await startOnce(deps, principal, setup, prompt, binding);
  return done;
}

async function startOnce(
  deps: ServerDeps,
  principal: Principal,
  setup: InferSetup,
  prompt: string,
  binding: ThreadRunBinding,
) {
  try {
    return await startExecution(deps, toPromptRequest(setup, prompt), undefined, principal, {
      binding,
      skipConfine: true,
    });
  } catch (error) {
    await abortThreadRun(deps, binding, error);
    throw error;
  }
}

async function bindingForAttempt(
  deps: ServerDeps,
  setup: InferSetup,
  attempt: number,
  prompt: string,
): Promise<ThreadRunBinding> {
  if (attempt === 0) {
    return {
      threadId: setup.threadId,
      runId: setup.runId,
      prompt: setup.rendered.instruction,
      startedAt: setup.startedAt,
      contextSummary: null,
      attachments: setup.attachments,
      mode: 'ask',
      checkpoint: null,
    };
  }
  const run = runningRun({
    threadId: setup.threadId,
    prompt,
    contextSummary: null,
    attachments: setup.attachments,
  });
  await deps.threads.updateRun(setup.threadId, run);
  return {
    threadId: setup.threadId,
    runId: run.id,
    prompt,
    startedAt: run.startedAt,
    contextSummary: null,
    attachments: setup.attachments,
    mode: 'ask',
    checkpoint: null,
  };
}

function toPromptRequest(setup: InferSetup, prompt: string): PromptRequest {
  return {
    provider: setup.provider,
    prompt,
    cwd: setup.scratch,
    mode: 'ask',
    ephemeral: setup.keep !== true,
    ...(setup.rendered.systemPrompt ? { systemPrompt: setup.rendered.systemPrompt } : {}),
    ...(setup.model ? { model: setup.model } : {}),
    ...(setup.timeoutMs !== undefined ? { timeoutMs: setup.timeoutMs } : {}),
    ...(setup.nativeSchema && setup.jsonSchema ? { jsonSchema: setup.jsonSchema } : {}),
  };
}

export async function resolveInferProvider(
  deps: ServerDeps,
  requested: ProviderType | undefined,
): Promise<{ provider: ProviderType; supportsJsonSchema: boolean }> {
  const listed = await deps.runtime.listCapabilities();
  const provider = pickProvider(requested, deps.config.defaultProvider, listed);
  const cap = listed.find((item) => item.provider === provider);
  if (!cap?.available) {
    throw new HttpError(422, 'provider_unavailable', `Provider ${provider} is not available`, cap?.setup);
  }
  return { provider, supportsJsonSchema: cap.supportsJsonSchema === true };
}

function pickProvider(
  requested: ProviderType | undefined,
  defaultProvider: ProviderType | undefined,
  listed: ProviderCapabilities[],
): ProviderType {
  if (requested) return requested;
  if (defaultProvider) return defaultProvider;
  const usable = listed.filter((item) => item.available && item.verified);
  const cursor = usable.find((item) => item.provider === 'cursor');
  if (cursor) return 'cursor';
  const first = usable[0];
  if (first) return first.provider;
  throw new HttpError(422, 'provider_unavailable', 'No verified provider is available');
}

function toResponse(
  setup: InferSetup,
  runId: string,
  text: string,
  events: UnifiedStreamEvent[],
): InferResponse {
  return {
    id: runId,
    provider: setup.provider,
    model: modelFromEvents(events, setup.model),
    text,
    durationMs: durationOf(setup),
    threadId: setup.threadId,
  };
}

export function collectAssistantText(events: readonly UnifiedStreamEvent[]): string {
  let text = '';
  for (const event of events) {
    if (!isAssistantChunk(event) || !event.payload.text) continue;
    text += event.payload.text;
  }
  return text;
}

function isAssistantChunk(event: UnifiedStreamEvent): boolean {
  return event.type === 'chunk' && event.payload.segment !== -1;
}

function modelFromEvents(events: readonly UnifiedStreamEvent[], fallback: string): string {
  for (const event of events) {
    if (event.type === 'session_info' && event.payload.model) return event.payload.model;
  }
  return fallback;
}

function durationOf(setup: InferSetup): number {
  return Math.max(0, Date.now() - setup.startedAt);
}

function errorPayload(error: HttpError): Record<string, unknown> {
  const setup =
    Array.isArray(error.details) && error.details.every((item) => typeof item === 'string')
      ? error.details
      : undefined;
  return {
    error: error.code,
    message: error.message,
    ...(setup ? { setup } : {}),
  };
}

function ensureUserText(
  messages: InferRequest['messages'],
  hasImages: boolean,
): InferRequest['messages'] {
  if (!hasImages) return messages;
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }
  if (lastUser === -1) return messages;
  const current = messages[lastUser];
  if (!current || current.content.trim()) return messages;
  const next = messages.slice();
  next[lastUser] = { ...current, content: 'See the attached images.' };
  return next;
}
