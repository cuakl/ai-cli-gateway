import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UnifiedStreamEvent } from '@aidev/protocol';
import { requirePrincipal } from '../auth/principal.js';
import { HttpError, sendHttpError } from '../errors.js';
import { cancelSession, sessionVisible, startExecution } from '../execute.js';
import { readPromptRequest } from './prompt.js';
import { formatSseEvent } from '../sse.js';
import type { ServerDeps } from '../types.js';

const SessionParamsSchema = z.object({
  id: z.string().min(1),
});

export function registerSessionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/v1/sessions', async (request, reply) => {
    try {
      const body = readPromptRequest(request.body);
      const { sessionId } = await startExecution(deps, body, undefined, requirePrincipal(request), {
        recordApi: true,
      });
      return reply.code(201).send({
        sessionId,
        status: 'running' as const,
        streamUrl: `/api/v1/sessions/${sessionId}/stream`,
      });
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(reply, error);
      throw error;
    }
  });

  app.get('/api/v1/sessions/:id', async (request, reply) => {
    const id = readSessionId(request);
    const record = deps.registry.get(id);
    if (!record) {
      return reply.code(404).send({ error: 'not_found', message: `Session ${id} was not found` });
    }
    if (!sessionVisible(deps, requirePrincipal(request), record.cwd)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return record;
  });

  app.delete('/api/v1/sessions/:id', async (request, reply) => {
    const id = readSessionId(request);
    const existing = deps.registry.get(id);
    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: `Session ${id} was not found` });
    }
    if (!sessionVisible(deps, requirePrincipal(request), existing.cwd)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (existing.status !== 'running' && existing.status !== 'pending') {
      return reply.code(409).send({ ok: false, sessionId: id, status: existing.status });
    }
    await cancelSession(deps.registry, id);
    return { ok: true, sessionId: id };
  });

  app.get('/api/v1/sessions/:id/stream', (request, reply) => {
    const id = readSessionId(request);
    const record = deps.registry.get(id);
    if (!record) {
      return reply.code(404).send({ error: 'not_found', message: `Session ${id} was not found` });
    }
    if (!sessionVisible(deps, requirePrincipal(request), record.cwd)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    streamSession(deps, id, request, reply);
  });
}

function readSessionId(request: FastifyRequest): string {
  const parsed = SessionParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new HttpError(400, 'validation_error', 'A session id is required');
  }
  return parsed.data.id;
}

/**
 * Replay the buffer, then write live events until `done` or the client leaves.
 * The snapshot and the live subscription are taken together so events emitted
 * between `POST /sessions` and this request are not skipped.
 */
function streamSession(
  deps: ServerDeps,
  id: string,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const headers = sseHeaders(reply);
  reply.hijack();
  reply.raw.writeHead(200, headers);

  let closed = false;
  let unsubscribe = (): void => {};

  const closeStream = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      try {
        reply.raw.end();
      } catch {
        // The socket is already gone.
      }
    }
  };

  const write = (event: UnifiedStreamEvent): void => {
    if (closed || reply.raw.writableEnded || reply.raw.destroyed) return;
    try {
      reply.raw.write(formatSseEvent(event));
    } catch {
      closeStream();
    }
  };

  request.raw.on('close', closeStream);
  reply.raw.on('error', closeStream);

  const subscription = deps.registry.subscribe(id, (event) => {
    write(event);
    if (event.type === 'done') closeStream();
  });
  if (!subscription) {
    closeStream();
    return;
  }
  unsubscribe = subscription.unsubscribe;

  let sawDone = false;
  for (const event of subscription.events) {
    write(event);
    if (event.type === 'done') sawDone = true;
  }
  if (sawDone) closeStream();
}

function sseHeaders(reply: FastifyReply): Record<string, string | number | string[]> {
  const headers: Record<string, string | number | string[]> = {};
  for (const [key, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) headers[key] = value;
  }
  delete headers['content-length'];
  headers['content-type'] = 'text/event-stream';
  headers['cache-control'] = 'no-cache';
  headers.connection = 'keep-alive';
  headers['x-accel-buffering'] = 'no';
  return headers;
}
