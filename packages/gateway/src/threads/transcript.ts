import { Buffer } from 'node:buffer';
import type { Run, ThreadEvent } from '@aidev/protocol';
import type { ThreadStore } from './store.js';

/** The `<previous_conversation>` block stays within this many UTF-8 bytes. */
export const PREVIOUS_CONVERSATION_MAX_BYTES = 8 * 1024;

const LAST_TURNS = 6;
const OPEN = '<previous_conversation>\n';
const CLOSE = '\n</previous_conversation>';

export interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Last 6 turns, oldest first, dropped from the front until the block fits in 8 KB.
 * A single oversized turn is truncated inside the tags.
 */
export function previousConversation(turns: readonly ConversationTurn[]): string | undefined {
  const recent = turns.slice(-LAST_TURNS);
  if (recent.length === 0) return undefined;
  const chosen = [...recent];
  while (chosen.length > 1 && Buffer.byteLength(format(chosen), 'utf8') > PREVIOUS_CONVERSATION_MAX_BYTES) {
    chosen.shift();
  }
  const block = format(chosen);
  if (Buffer.byteLength(block, 'utf8') <= PREVIOUS_CONVERSATION_MAX_BYTES) return block;
  const overhead = Buffer.byteLength(OPEN, 'utf8') + Buffer.byteLength(CLOSE, 'utf8');
  const body = chosen.map(formatTurn).join('\n\n');
  return `${OPEN}${truncateUtf8(body, PREVIOUS_CONVERSATION_MAX_BYTES - overhead)}${CLOSE}`;
}

/** User prompt plus assistant chunks. Notice chunks (`segment: -1`) are omitted. */
export function turnsFromHistory(runs: readonly Run[], events: readonly ThreadEvent[], excludeRunId?: string): ConversationTurn[] {
  return runs
    .filter((run) => run.id !== excludeRunId)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((run) => ({
      user: run.prompt,
      assistant: assistantText(events, run.id),
    }));
}

export async function loadPreviousConversation(
  store: ThreadStore,
  threadId: string,
  excludeRunId?: string,
): Promise<string | undefined> {
  const record = await store.getThread(threadId);
  if (!record) return undefined;
  const events = await store.readEvents(threadId);
  return previousConversation(turnsFromHistory(record.runs, events, excludeRunId));
}

function assistantText(events: readonly ThreadEvent[], runId: string): string {
  let text = '';
  for (const record of events) {
    if (record.runId !== runId || record.event.type !== 'chunk') continue;
    if (record.event.payload.segment === -1) continue;
    if (record.event.payload.text) text += record.event.payload.text;
  }
  return text;
}

function format(turns: readonly ConversationTurn[]): string {
  return `${OPEN}${turns.map(formatTurn).join('\n\n')}${CLOSE}`;
}

function formatTurn(turn: ConversationTurn): string {
  return `User: ${turn.user}\nAssistant: ${turn.assistant}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const mark = '…';
  const markBytes = Buffer.byteLength(mark, 'utf8');
  if (maxBytes <= markBytes) return '';
  const budget = maxBytes - markBytes;
  let best = 0;
  let low = 0;
  let high = value.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= budget) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return value.slice(0, best) + mark;
}
