import type { UnifiedStreamEvent } from '@aidev/protocol';

/** Wire format from the streaming protocol: one event name, one JSON data line. */
export function formatSseEvent(event: UnifiedStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
