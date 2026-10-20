import {
  FrontendContextPayloadSchema,
  ProviderTypeSchema,
  createStreamEvent,
  type UnifiedStreamEvent,
} from '@gateway/shared-types';
import type { ViteDevServer } from 'vite';
import { z } from 'zod';
import type { DevtoolsPromptInput, PromptRunner, PromptSession } from './bridge.js';

export const PROMPT_EVENT = 'ai-devtools:prompt';
export const CANCEL_EVENT = 'ai-devtools:cancel';
export const STREAM_EVENT = 'ai-devtools:stream-event';

const PromptPayloadSchema = z.object({
  provider: ProviderTypeSchema,
  prompt: z.string().min(1),
  cwd: z.string().min(1).optional(),
  files: z.array(z.string()).optional(),
  context: FrontendContextPayloadSchema.optional(),
  yolo: z.boolean().optional(),
  ephemeral: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

const CancelPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

interface StreamClient {
  send(event: string, data?: unknown): void;
  socket?: {
    once(event: 'close', listener: () => void): void;
  };
}

/**
 * Bridge overlay prompts on Vite's HMR socket to a gateway or `@gateway/core` session.
 * Stream events go back as `ai-devtools:stream-event`.
 */
export function registerDevtoolsSocket(server: ViteDevServer, runner: PromptRunner, cwd: string): void {
  const sessions = new WeakMap<StreamClient, Map<string, PromptSession>>();

  server.ws.on(PROMPT_EVENT, (data: unknown, client: StreamClient) => {
    return handlePrompt(data, client).catch((error: unknown) => {
      server.config.logger.error(error instanceof Error ? error.message : 'AI DevTools prompt failed');
    });
  });

  server.ws.on(CANCEL_EVENT, (data: unknown, client: StreamClient) => {
    return cancelPrompt(sessions, client, data).catch((error: unknown) => {
      server.config.logger.error(error instanceof Error ? error.message : 'AI DevTools cancel failed');
    });
  });

  async function handlePrompt(data: unknown, client: StreamClient): Promise<void> {
    const parsed = PromptPayloadSchema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid prompt';
      emitTerminal(client, 'invalid', message);
      return;
    }

    const input: DevtoolsPromptInput = {
      provider: parsed.data.provider,
      prompt: parsed.data.prompt,
      cwd: parsed.data.cwd ?? cwd,
      ...(parsed.data.files !== undefined ? { files: parsed.data.files } : {}),
      ...(parsed.data.context !== undefined ? { context: parsed.data.context } : {}),
      ...(parsed.data.yolo !== undefined ? { yolo: parsed.data.yolo } : {}),
      ...(parsed.data.ephemeral !== undefined ? { ephemeral: parsed.data.ephemeral } : {}),
      ...(parsed.data.sessionId !== undefined ? { sessionId: parsed.data.sessionId } : {}),
    };

    const tracked: { session?: PromptSession } = {};
    let finished = false;
    const session = await runner.start(input, (event) => {
      sendEvent(client, event);
      if (event.type !== 'done') return;
      finished = true;
      const current = tracked.session;
      if (!current) return;
      sessions.get(client)?.delete(current.sessionId);
    });
    tracked.session = session;
    if (finished) return;

    let map = sessions.get(client);
    if (!map) {
      map = new Map();
      sessions.set(client, map);
    }
    map.set(session.sessionId, session);
    client.socket?.once('close', () => {
      const current = sessions.get(client)?.get(session.sessionId);
      if (!current) return;
      sessions.get(client)?.delete(session.sessionId);
      void current.cancel();
    });
  }
}

async function cancelPrompt(
  sessions: WeakMap<StreamClient, Map<string, PromptSession>>,
  client: StreamClient,
  data: unknown,
): Promise<void> {
  const map = sessions.get(client);
  if (!map || map.size === 0) return;
  const parsed = CancelPayloadSchema.safeParse(data ?? {});
  const requested = parsed.success ? parsed.data.sessionId : undefined;
  const targets = requested
    ? compact([map.get(requested)])
    : [...map.values()].slice(-1);
  for (const session of targets) {
    map.delete(session.sessionId);
    await session.cancel();
  }
}

function emitTerminal(client: StreamClient, sessionId: string, message: string): void {
  sendEvent(client, createStreamEvent(sessionId, 'error', { error: message }));
  sendEvent(client, createStreamEvent(sessionId, 'done', {}));
}

function sendEvent(client: StreamClient, event: UnifiedStreamEvent): void {
  client.send(STREAM_EVENT, { event });
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}
