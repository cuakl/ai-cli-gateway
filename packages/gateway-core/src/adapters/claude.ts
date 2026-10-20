import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@gateway/shared-types';
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
 * Headless invocation:
 * `claude --bare -p "<prompt>" --output-format stream-json --allowedTools <list> --permission-prompts none`
 */
export class ClaudeAdapter extends BaseAdapter {
  override readonly provider = 'claude' as const;

  override buildArgs(options: PromptOptions): string[] {
    const tools = options.allowedTools ?? [...DEFAULT_CLAUDE_TOOLS];
    return [
      '--bare',
      '-p',
      options.prompt,
      '--output-format',
      'stream-json',
      '--allowedTools',
      tools.join(','),
      '--permission-prompts',
      'none',
    ];
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return parseClaudeLine(line, sessionId);
  }
}

export function parseClaudeLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [textChunk(sessionId, line)];

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
        createStreamEvent(sessionId, 'error', {
          error: stringField(record, 'error', 'result', 'message') ?? 'Claude reported an error',
        }),
      );
    }
    events.push(doneEvent(sessionId, record, stringField(record, 'result', 'text', 'summary')));
    return events;
  }

  if (IGNORED_TYPES.has(type)) return [];

  const text = extractText(record);
  return [textChunk(sessionId, text ?? line)];
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
