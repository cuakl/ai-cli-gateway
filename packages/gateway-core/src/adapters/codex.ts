import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@gateway/shared-types';
import { BaseAdapter } from './base.js';
import {
  doneEvent,
  errorEvent,
  eventType,
  eventsForToolCall,
  extractText,
  extractToolOutput,
  fileEditEvents,
  isDoneType,
  isFileType,
  isRecord,
  isTextType,
  isToolCallType,
  isToolResultType,
  parseJsonRecord,
  stringField,
  textChunk,
  toolResultEvent,
} from './parse.js';

/**
 * OpenAI Codex CLI (`codex`).
 *
 * Headless invocation:
 * `codex exec --jsonl --sandbox workspace-write "<prompt>"`
 * A session id inserts `resume <id>` after `exec`.
 */
export class CodexAdapter extends BaseAdapter {
  override readonly provider = 'codex' as const;

  override buildArgs(options: PromptOptions): string[] {
    const args = ['exec'];
    if (options.sessionId) args.push('resume', options.sessionId);
    args.push('--jsonl', '--sandbox', 'workspace-write', options.prompt);
    return args;
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return parseCodexLine(line, sessionId);
  }
}

export function parseCodexLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [textChunk(sessionId, line)];

  const type = eventType(record);
  if (type === 'error') return [errorEvent(record, sessionId, line)];

  if (type === 'item.updated') return codexItemUpdate(record, sessionId);
  if (type === 'item.started' || type === 'item.completed') {
    if (!isRecord(record.item)) return [textChunk(sessionId, line)];
    const mapped = codexItemEvents(type === 'item.started' ? 'started' : 'completed', record.item, sessionId);
    return mapped.length > 0 ? mapped : [textChunk(sessionId, line)];
  }

  if (type === 'turn.completed' || type === 'turn.done' || isDoneType(type)) {
    return [doneEvent(sessionId, record, stringField(record, 'text', 'result', 'summary'))];
  }

  if (isToolCallType(type)) {
    const events = eventsForToolCall(record, sessionId);
    return events.length > 0 ? events : [textChunk(sessionId, line)];
  }
  if (isToolResultType(type)) return [toolResultEvent(record, sessionId)];
  if (isFileType(type)) {
    const edits = fileEditEvents(record, sessionId);
    return edits.length > 0 ? edits : [textChunk(sessionId, line)];
  }
  if (isTextType(type)) return [textChunk(sessionId, extractText(record) ?? line)];

  if (type === 'thread.started' || type === 'turn.started' || type === 'session.started') {
    const text = extractText(record);
    return [createStreamEvent(sessionId, 'init', text ? { text } : {})];
  }

  const text = extractText(record);
  return [textChunk(sessionId, text ?? line)];
}

function codexItemUpdate(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  if (!isRecord(record.item)) return [];
  const itemType = eventType(record.item);
  if (itemType !== 'agent_message' && itemType !== 'message' && itemType !== 'reasoning') return [];
  const text = stringField(record.item, 'text', 'content');
  return text ? [textChunk(sessionId, text)] : [];
}

function codexItemEvents(
  phase: 'started' | 'completed',
  item: Record<string, unknown>,
  sessionId: string,
): UnifiedStreamEvent[] {
  const itemType = eventType(item);
  if (
    itemType === 'agent_message' ||
    itemType === 'message' ||
    itemType === 'text' ||
    itemType === 'reasoning'
  ) {
    const text = stringField(item, 'text', 'content', 'message');
    return text ? [textChunk(sessionId, text)] : [];
  }

  if (
    itemType === 'command_execution' ||
    itemType === 'tool_call' ||
    itemType === 'function_call' ||
    itemType === 'mcp_tool_call'
  ) {
    if (phase === 'started') {
      const toolName = stringField(item, 'name', 'toolName') ?? itemType;
      const command = stringField(item, 'command');
      const explicit = isRecord(item.arguments)
        ? item.arguments
        : isRecord(item.args)
          ? item.args
          : isRecord(item.input)
            ? item.input
            : undefined;
      const toolArgs = explicit ?? (command ? { command } : undefined);
      return [
        createStreamEvent(sessionId, 'tool_call', {
          toolName,
          ...(toolArgs ? { toolArgs } : {}),
        }),
      ];
    }
    const toolOutput = stringField(item, 'aggregated_output', 'output', 'stdout') ?? extractToolOutput(item);
    return [createStreamEvent(sessionId, 'tool_result', toolOutput !== undefined ? { toolOutput } : {})];
  }

  if (itemType === 'file_change' || itemType === 'file_edit' || itemType === 'file_changed') {
    return fileEditEvents(item, sessionId);
  }

  return [];
}
