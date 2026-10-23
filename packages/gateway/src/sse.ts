import type { ThreadEvent, UnifiedStreamEvent } from '@aidev/protocol';
import type { FastifyReply } from 'fastify';

/** One named SSE frame with a JSON `data` payload. */
export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Wire format from the streaming protocol: one event name, one JSON data line. */
export function formatSseEvent(event: UnifiedStreamEvent): string {
  return formatSse(event.type, event);
}

/** One stored thread event. `data` is the JSONL object `{ runId, event }`. */
export function formatThreadSseEvent(record: ThreadEvent): string {
  return formatSse(record.event.type, record);
}

export function sseHeaders(reply: FastifyReply): Record<string, string | number | string[]> {
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
