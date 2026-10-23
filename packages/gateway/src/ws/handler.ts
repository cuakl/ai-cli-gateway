import { Buffer } from 'node:buffer';
import {
  GatewayClientMessageSchema,
  type GatewayClientMessage,
  type GatewayServerMessage,
  type PromptRequest,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requirePrincipal } from '../auth/principal.js';
import { HttpError } from '../errors.js';
import { cancelSession, sessionVisible, startExecution } from '../execute.js';
import type { ServerDeps } from '../types.js';

const WS_OPEN = 1;

export function registerWebSocketRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    let principal: ReturnType<typeof requirePrincipal>;
    try {
      principal = requirePrincipal(request);
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    const subscriptions: Array<() => void> = [];

    const send = (message: GatewayServerMessage): void => {
      if (socket.readyState !== WS_OPEN) return;
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // The client went away. The CLI session keeps running for SSE clients.
      }
    };

    socket.on('error', () => {
      // `close` follows and drops the event subscriptions.
    });
    socket.on('close', () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.length = 0;
    });

    socket.on('message', (data: unknown) => {
      void handleMessage(data).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Invalid message';
        send({ type: 'error', message });
      });
    });

    async function handleMessage(data: unknown): Promise<void> {
      const text = messageText(data);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        send({ type: 'error', message: 'Invalid JSON message' });
        return;
      }
      const parsed = GatewayClientMessageSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = issue
          ? `${issue.path.join('.') || 'message'}: ${issue.message}`
          : 'Invalid message';
        send({ type: 'error', message });
        return;
      }
      if (parsed.data.type === 'cancel') {
        await handleCancel(parsed.data.sessionId);
        return;
      }
      await handlePrompt(parsed.data);
    }

    async function handleCancel(sessionId: string): Promise<void> {
      const existing = deps.registry.get(sessionId);
      if (!existing) {
        send({ type: 'error', sessionId, message: `Session ${sessionId} was not found` });
        return;
      }
      if (!sessionVisible(deps, principal, existing.cwd)) {
        send({ type: 'error', sessionId, message: 'Session is outside this project' });
        return;
      }
      await cancelSession(deps.registry, sessionId);
    }

    async function handlePrompt(message: Extract<GatewayClientMessage, { type: 'prompt' }>): Promise<void> {
      let started: Awaited<ReturnType<typeof startExecution>>;
      try {
        started = await startExecution(deps, promptFromMessage(message), undefined, principal);
      } catch (error) {
        const httpError = error instanceof HttpError ? error : undefined;
        send({
          type: 'error',
          ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
          message: httpError?.message ?? (error instanceof Error ? error.message : 'Prompt failed'),
        });
        return;
      }

      const { sessionId } = started;
      let live = false;
      const queued: UnifiedStreamEvent[] = [];
      const subscription = deps.registry.subscribe(sessionId, (event) => {
        if (live) send({ type: 'event', event });
        else queued.push(event);
      });
      if (!subscription) {
        send({ type: 'error', sessionId, message: `Session ${sessionId} was not found` });
        return;
      }
      subscriptions.push(subscription.unsubscribe);

      // `ready` goes out before any replayed or live event for this prompt.
      send({ type: 'ready', sessionId });
      const buffered = subscription.events.concat(queued.splice(0, queued.length));
      live = true;
      for (const event of buffered) send({ type: 'event', event });
    }
  });
}

function promptFromMessage(message: Extract<GatewayClientMessage, { type: 'prompt' }>): PromptRequest {
  return {
    provider: message.provider,
    cwd: message.cwd,
    prompt: message.prompt,
    ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
    ...(message.yolo !== undefined ? { yolo: message.yolo } : {}),
    ...(message.ephemeral !== undefined ? { ephemeral: message.ephemeral } : {}),
    ...(message.files !== undefined ? { files: message.files } : {}),
  };
}

function messageText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data) && data.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(data).toString('utf8');
  }
  return String(data);
}
