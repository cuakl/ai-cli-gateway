import type { PromptOptions, UnifiedStreamEvent } from '@gateway/shared-types';
import { BaseAdapter } from './base.js';
import {
  doneEvent,
  errorEvent,
  eventType,
  eventsForToolCall,
  extractText,
  isDoneType,
  isRecord,
  isToolCallType,
  parseJsonRecord,
  stringField,
  textChunk,
  toolResultEvent,
} from './parse.js';

export const DEFAULT_CLAUDE_TOOLS = ['Read', 'Edit', 'Bash', 'Glob', 'Grep'] as const;

const IGNORED_TYPES = new Set([
  'system',
  'ping',
  'message_start',
  'message_stop',
  'message_delta',
  'content_block_stop',
]);

/**
 * Claude Code CLI (`claude`).
 *
 * Agent mode, checked against Claude Code 2.1.173:
 * `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools <list>`
 * `--verbose` is required. Without it, stream-json with `-p` exits immediately.
 * `--include-partial-messages` emits `stream_event` text deltas and then an
 * `assistant` message with the same text. Deltas are kept; the repeat is not.
 * `--bare` is omitted so an existing Claude Code login still works.
 */
export class ClaudeAdapter extends BaseAdapter {
  override readonly provider = 'claude' as const;
  private readonly lines = new ClaudeLineParser();

  override buildArgs(options: PromptOptions): string[] {
    const tools = options.allowedTools ?? [...DEFAULT_CLAUDE_TOOLS];
    return [
      '-p',
      options.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      tools.join(','),
    ];
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return this.lines.parse(line, sessionId);
  }

  protected override async afterExecute(_options: PromptOptions, sessionId: string): Promise<void> {
    this.lines.reset(sessionId);
  }
}

/**
 * Partial `stream_event` deltas and the final `assistant` message carry the
 * same text. Text already shown for this turn is dropped. Tool calls inside
 * a `stream_event` arrive with an empty `input`; the assistant message has
 * the finished arguments, so only that copy is kept.
 */
export class ClaudeLineParser {
  private readonly streamed = new Map<string, string>();

  parse(line: string, sessionId: string): UnifiedStreamEvent[] {
    const record = parseJsonRecord(line);
    const events = parseClaudeLine(line, sessionId);
    if (!record) return events;

    const type = eventType(record);
    if (type === 'stream_event') {
      const text = events
        .filter((event) => event.type === 'chunk')
        .map((event) => event.payload.text ?? '')
        .join('');
      if (text) this.streamed.set(sessionId, (this.streamed.get(sessionId) ?? '') + text);
      return events.filter((event) => event.type !== 'tool_call' && event.type !== 'file_edit');
    }

    if (type === 'assistant') {
      const streamed = this.streamed.get(sessionId);
      this.streamed.delete(sessionId);
      return suppressDuplicateText(events, streamed);
    }

    return events;
  }

  reset(sessionId: string): void {
    this.streamed.delete(sessionId);
  }
}

export function parseClaudeLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [textChunk(sessionId, line)];
  if (eventType(record) === 'stream_event') {
    return isRecord(record.event) ? eventsFromClaudeRecord(record.event, sessionId, line) : [];
  }
  return eventsFromClaudeRecord(record, sessionId, line);
}

function eventsFromClaudeRecord(
  record: Record<string, unknown>,
  sessionId: string,
  line: string,
): UnifiedStreamEvent[] {
  const type = eventType(record);
  if (type === 'error') return [errorEvent(record, sessionId, line)];

  const delta = isRecord(record.delta) ? record.delta : undefined;
  const deltaType = delta ? eventType(delta) : '';
  if (type === 'text_delta' || deltaType === 'text_delta' || type === 'content_block_delta') {
    if (deltaType === 'input_json_delta') return [];
    const text = stringField(record, 'text') ?? (delta ? stringField(delta, 'text') : undefined);
    return text ? [textChunk(sessionId, text)] : [];
  }

  if (type === 'content_block_start' && isRecord(record.content_block)) {
    return eventsFromBlock(record.content_block, sessionId);
  }

  if (isToolCallType(type)) {
    const events = eventsForToolCall(record, sessionId);
    return events.length > 0 ? events : [textChunk(sessionId, line)];
  }

  if (type === 'assistant' || type === 'user') {
    const message = isRecord(record.message) ? record.message : record;
    const events = eventsFromContent(message.content, sessionId);
    if (events.length > 0) return events;
    const text = extractText(message);
    return text ? [textChunk(sessionId, text)] : [];
  }

  if (isDoneType(type)) {
    const events: UnifiedStreamEvent[] = [];
    if (record.is_error === true) {
      events.push(
        errorEvent(
          { error: stringField(record, 'error', 'result', 'message') ?? 'Claude reported an error' },
          sessionId,
          line,
        ),
      );
    }
    events.push(doneEvent(sessionId, record, stringField(record, 'result', 'text', 'summary')));
    return events;
  }

  if (IGNORED_TYPES.has(type)) return [];

  const text = extractText(record);
  return [textChunk(sessionId, text ?? line)];
}

function suppressDuplicateText(
  events: UnifiedStreamEvent[],
  streamed: string | undefined,
): UnifiedStreamEvent[] {
  if (!streamed) return events;
  let remaining = streamed;
  const kept: UnifiedStreamEvent[] = [];
  for (const event of events) {
    if (event.type !== 'chunk') {
      kept.push(event);
      continue;
    }
    const text = event.payload.text ?? '';
    if (!text || remaining.startsWith(text)) {
      remaining = remaining.slice(text.length);
      continue;
    }
    kept.push(event);
  }
  return kept;
}

function eventsFromContent(content: unknown, sessionId: string): UnifiedStreamEvent[] {
  if (!Array.isArray(content)) return [];
  const events: UnifiedStreamEvent[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    events.push(...eventsFromBlock(block, sessionId));
  }
  return events;
}

function eventsFromBlock(block: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  const blockType = eventType(block);
  if (blockType === 'text' || blockType === 'text_delta') {
    const text = stringField(block, 'text');
    return text ? [textChunk(sessionId, text)] : [];
  }
  if (blockType === 'tool_use' || blockType === 'tool_call') return eventsForToolCall(block, sessionId);
  if (blockType === 'tool_result') return [toolResultEvent(block, sessionId)];
  return [];
}
