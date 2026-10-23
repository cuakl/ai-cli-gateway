import {
  RunIdSchema,
  ThreadIdSchema,
  ThreadSourceSchema,
  type Thread,
  type ThreadEvent,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePrincipal, sendForbidden, type Principal } from '../auth/principal.js';
import { HttpError, sendHttpError } from '../errors.js';
import { formatThreadSseEvent } from '../sse.js';
import { deleteThreadFully } from '../threads/control.js';
import { ThreadStoreError } from '../threads/store.js';
import type { ActiveRun } from '../threads/active.js';
import type { ServerDeps } from '../types.js';

const ListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  source: ThreadSourceSchema.optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const ParamsSchema = z.object({
  id: ThreadIdSchema,
});

const EventsQuerySchema = z.object({
  runId: RunIdSchema.optional(),
});

export function threadVisible(principal: Principal, thread: Thread): boolean {
  if (principal.kind === 'machine') return true;
  return thread.projectId !== null && thread.projectId === principal.projectId;
}

export function registerThreadRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/v1/threads', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      const query = readListQuery(request.query);
      if (principal.kind === 'browser') {
        if (query.projectId !== undefined && query.projectId !== principal.projectId) return sendForbidden(reply);
        query.projectId = principal.projectId;
      }
      const threads = await deps.threads.listThreads(query);
      return { threads };
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.get('/api/v1/threads/:id', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      const id = readThreadId(request);
      const record = await deps.threads.getThread(id);
      if (!record) {
        return reply.code(404).send({ error: 'not_found', message: `Thread ${id} was not found` });
      }
      if (!threadVisible(principal, record.thread)) return sendForbidden(reply);
      return { thread: record.thread, runs: record.runs };
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.delete('/api/v1/threads/:id', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      const id = readThreadId(request);
      const record = await deps.threads.getThread(id);
      if (!record) {
        return reply.code(404).send({ error: 'not_found', message: `Thread ${id} was not found` });
      }
      if (!threadVisible(principal, record.thread)) return sendForbidden(reply);
      await deleteThreadFully(deps, id);
      return { ok: true, threadId: id };
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.get('/api/v1/threads/:id/events', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      const id = readThreadId(request);
      const runId = readRunFilter(request);
      const record = await deps.threads.getThread(id);
      if (!record) {
        return reply.code(404).send({ error: 'not_found', message: `Thread ${id} was not found` });
      }
      if (!threadVisible(principal, record.thread)) return sendForbidden(reply);
      await streamThreadEvents(deps, id, runId, request, reply);
    } catch (error) {
      if (reply.sent || reply.raw.headersSent) return;
      return sendFailure(reply, error);
    }
  });
}

function readListQuery(query: unknown): z.infer<typeof ListQuerySchema> {
  const source = isRecord(query) ? query : {};
  const raw: Record<string, unknown> = {};
  if (present(source.projectId)) raw.projectId = first(source.projectId);
  if (present(source.source)) raw.source = first(source.source);
  if (present(source.limit)) raw.limit = first(source.limit);
  const parsed = ListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue ? `${issue.path.join('.') || 'query'}: ${issue.message}` : 'Invalid query';
    throw new HttpError(400, 'validation_error', message, parsed.error.issues);
  }
  return parsed.data;
}

function readThreadId(request: FastifyRequest): string {
  const parsed = ParamsSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, 'validation_error', 'A thread id is required');
  return parsed.data.id;
}

function readRunFilter(request: FastifyRequest): string | undefined {
  const source = isRecord(request.query) ? request.query : {};
  if (!present(source.runId)) return undefined;
  const parsed = EventsQuerySchema.safeParse({ runId: first(source.runId) });
  if (!parsed.success) throw new HttpError(400, 'validation_error', 'runId must be a run id');
  return parsed.data.runId;
}

function activeRun(deps: ServerDeps, threadId: string, runId: string | undefined): ActiveRun | undefined {
  const active = deps.runs.forThread(threadId);
  if (!active) return undefined;
  if (runId !== undefined && active.runId !== runId) return undefined;
  return active;
}

/**
 * Replay the JSONL log, then follow the session until `done` when that run is still active.
 */
async function streamThreadEvents(
  deps: ServerDeps,
  threadId: string,
  runId: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const active = activeRun(deps, threadId, runId);
  const queued: UnifiedStreamEvent[] = [];
  let unsubscribe = (): void => {};
  let snapshot: UnifiedStreamEvent[] = [];
  let followed: ActiveRun | undefined;
  let ready = false;
  // Declared up front so a live event during `readEvents` only queues.
  let pumping = false;

  const onLive = (event: UnifiedStreamEvent): void => {
    queued.push(event);
    if (ready) pump();
  };

  if (active) {
    const subscription = deps.registry.subscribe(active.sessionId, onLive);
    if (subscription) {
      snapshot = subscription.events;
      unsubscribe = subscription.unsubscribe;
      followed = active;
    }
  }

  const stored = await deps.threads.readEvents(threadId, runId);
  reply.hijack();
  reply.raw.writeHead(200, sseHeaders(reply));

  let closed = false;
  let sawDone = false;
  const seen = new Set<string>();
  const liveRunId = followed?.runId;

  const closeStream = (): void => {
    if (closed) return;
    closed = true;
    ready = false;
    unsubscribe();
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      try {
        reply.raw.end();
      } catch {
        // The socket is already gone.
      }
    }
  };

  const write = (record: ThreadEvent): void => {
    if (closed || reply.raw.writableEnded || reply.raw.destroyed) return;
    try {
      reply.raw.write(formatThreadSseEvent(record));
    } catch {
      closeStream();
    }
  };

  const emit = (record: ThreadEvent): void => {
    if (seen.has(record.event.id)) return;
    seen.add(record.event.id);
    write(record);
    if (liveRunId !== undefined && record.runId === liveRunId && record.event.type === 'done') sawDone = true;
  };

  function pump(): void {
    if (!liveRunId || pumping || closed) return;
    pumping = true;
    try {
      while (queued.length > 0 && !sawDone) {
        const event = queued.shift();
        if (!event) break;
        emit({ runId: liveRunId, event });
      }
    } finally {
      pumping = false;
    }
    if (queued.length > 0 && !sawDone && !closed) pump();
    if (sawDone) closeStream();
  }

  request.raw.on('close', closeStream);
  reply.raw.on('error', closeStream);

  for (const record of stored) emit(record);
  if (liveRunId) {
    for (const event of snapshot) emit({ runId: liveRunId, event });
  }
  ready = true;
  pump();
  if (!followed || sawDone) closeStream();
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

function sendFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) return sendHttpError(reply, error);
  if (error instanceof ThreadStoreError) {
    return sendHttpError(reply, new HttpError(500, 'thread_store', error.message));
  }
  throw error;
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
