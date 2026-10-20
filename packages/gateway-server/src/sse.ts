import type { UnifiedStreamEvent } from '@gateway/shared-types';

/** Wire format from the streaming protocol: one event name, one JSON data line. */
export function formatSseEvent(event: UnifiedStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
