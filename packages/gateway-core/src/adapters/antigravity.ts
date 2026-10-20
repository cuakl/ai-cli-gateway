import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@gateway/shared-types';
import { BaseAdapter } from './base.js';
import {
  doneEvent,
  errorEvent,
  eventType,
  eventsForToolCall,
  extractText,
  fileEditEvents,
  isDoneType,
  isFileType,
  isTextType,
  isToolCallType,
  isToolResultType,
  parseJsonRecord,
  stringField,
  textChunk,
  toolResultEvent,
} from './parse.js';

/**
 * Antigravity CLI (`agy`).
 *
 * Headless invocation:
 * `agy --print "<prompt>" --output-format stream-json --workspace <cwd>`
 * `--print` is the long form of `-p`. A session id adds `--conversation <id>`
 * (the id-bearing form of `--continue`). Context files are repeated `--file` args.
 */
export class AntigravityAdapter extends BaseAdapter {
  override readonly provider = 'antigravity' as const;

  override buildArgs(options: PromptOptions): string[] {
    const args = [
      '--print',
      options.prompt,
      '--output-format',
      'stream-json',
      '--workspace',
      options.cwd,
    ];
    if (options.sessionId) args.push('--conversation', options.sessionId);
    if (options.files?.length) {
      for (const file of options.files) {
        if (file.length > 0) args.push('--file', file);
      }
    }
    return args;
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return parseAntigravityLine(line, sessionId);
  }
}

export function parseAntigravityLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [textChunk(sessionId, line)];

  const type = eventType(record);
  if (type === 'error') return [errorEvent(record, sessionId, line)];
  if (type === 'init' || type === 'session' || type === 'session_start') {
    const text = extractText(record);
    return [createStreamEvent(sessionId, 'init', text ? { text } : {})];
  }
  if (isTextType(type)) return [textChunk(sessionId, extractText(record) ?? line)];
  if (isToolCallType(type)) {
    const events = eventsForToolCall(record, sessionId);
    return events.length > 0 ? events : [textChunk(sessionId, line)];
  }
  if (isToolResultType(type)) return [toolResultEvent(record, sessionId)];
  if (isFileType(type)) {
    const edits = fileEditEvents(record, sessionId);
    return edits.length > 0 ? edits : [textChunk(sessionId, line)];
  }
  if (isDoneType(type)) {
    return [doneEvent(sessionId, record, stringField(record, 'text', 'result', 'summary'))];
  }

  const text = extractText(record);
  if (text) return [textChunk(sessionId, text)];
  const edits = fileEditEvents(record, sessionId);
  return edits.length > 0 ? edits : [textChunk(sessionId, line)];
}
