import { randomUUID } from 'node:crypto';
import type { StreamEventPayload, UnifiedStreamEvent } from '@aidev/protocol';

/**
 * Bookkeeping for one adapter run.
 * A CLI `result` line is captured here instead of forwarded. The process
 * supervisor emits the only `done` after exit, and that event carries the
 * captured summary, duration, and usage. Chunk `segment` starts at 0 and
 * advances when a tool call follows assistant text. Tool results reuse the
 * CLI id, or the oldest unmatched call.
 */
export class RunStream {
  private segment = 0;
  private sawText = false;
  private readonly pendingIds: string[] = [];
  private captured: StreamEventPayload = {};

  accept(events: UnifiedStreamEvent[]): UnifiedStreamEvent[] {
    const kept: UnifiedStreamEvent[] = [];
    for (const event of events) {
      if (event.type === 'done') {
        this.captured = { ...this.captured, ...event.payload };
        continue;
      }
      if (event.type === 'chunk') {
        kept.push({ ...event, payload: { ...event.payload, segment: this.segment } });
        if ((event.payload.text ?? '').length > 0) this.sawText = true;
        continue;
      }
      if (event.type === 'tool_call') {
        if (this.sawText) {
          this.segment += 1;
          this.sawText = false;
        }
        const toolCallId = event.payload.toolCallId ?? randomUUID();
        this.pendingIds.push(toolCallId);
        kept.push({ ...event, payload: { ...event.payload, toolCallId } });
        continue;
      }
      if (event.type === 'tool_result') {
        const toolCallId = this.takeResultId(event.payload.toolCallId);
        kept.push({ ...event, payload: { ...event.payload, toolCallId } });
        continue;
      }
      kept.push(event);
    }
    return kept;
  }

  finish(wall: StreamEventPayload): StreamEventPayload {
    return { ...wall, ...this.captured };
  }

  private takeResultId(explicit: string | undefined): string {
    if (explicit) {
      const index = this.pendingIds.indexOf(explicit);
      if (index >= 0) this.pendingIds.splice(index, 1);
      return explicit;
    }
    return this.pendingIds.shift() ?? randomUUID();
  }
}
