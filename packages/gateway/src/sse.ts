import type { ThreadEvent, UnifiedStreamEvent } from '@aidev/protocol';

/** Wire format from the streaming protocol: one event name, one JSON data line. */
export function formatSseEvent(event: UnifiedStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** One stored thread event. `data` is the JSONL object `{ runId, event }`. */
export function formatThreadSseEvent(record: ThreadEvent): string {
  return `event: ${record.event.type}\ndata: ${JSON.stringify(record)}\n\n`;
}
