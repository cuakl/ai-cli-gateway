import { createStreamEvent, type UnifiedStreamEvent } from '@gateway/shared-types';

const TEXT_TYPES = new Set([
  'text',
  'text_delta',
  'delta',
  'chunk',
  'message',
  'assistant',
  'content',
  'agent_message',
]);

const TOOL_CALL_TYPES = new Set(['tool_call', 'tool_use', 'tool_invocation', 'function_call']);

const TOOL_RESULT_TYPES = new Set([
  'tool_result',
  'tool_complete',
  'tool_completion',
  'function_call_output',
]);

const FILE_TYPES = new Set([
  'file_edit',
  'file_change',
  'file_modified',
  'file_changed',
  'edit',
]);

const DONE_TYPES = new Set(['done', 'result', 'summary', 'complete', 'completed']);

const EDIT_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'strreplace',
  'file_edit',
  'apply_patch',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonRecord(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function eventType(record: Record<string, unknown>): string {
  return (stringField(record, 'type', 'event') ?? '').toLowerCase();
}

export function isTextType(type: string): boolean {
  return TEXT_TYPES.has(type);
}

export function isToolCallType(type: string): boolean {
  return TOOL_CALL_TYPES.has(type);
}

export function isToolResultType(type: string): boolean {
  return TOOL_RESULT_TYPES.has(type);
}

export function isFileType(type: string): boolean {
  return FILE_TYPES.has(type);
}

export function isDoneType(type: string): boolean {
  return DONE_TYPES.has(type);
}

export function textChunk(sessionId: string, text: string): UnifiedStreamEvent {
  return createStreamEvent(sessionId, 'chunk', { text });
}

export function extractText(record: Record<string, unknown>): string | undefined {
  const direct = stringField(record, 'text', 'delta', 'content', 'message', 'summary');
  if (direct) return direct;
  if (isRecord(record.delta)) {
    const nested = stringField(record.delta, 'text', 'content');
    if (nested) return nested;
  }
  if (isRecord(record.message)) {
    const nested = stringField(record.message, 'text', 'content');
    if (nested) return nested;
    const joined = joinBlockText(record.message.content);
    if (joined) return joined;
  }
  return joinBlockText(record.content);
}

function joinBlockText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const part of value) {
    if (typeof part === 'string' && part.length > 0) parts.push(part);
    else if (isRecord(part)) {
      const text = stringField(part, 'text');
      if (text) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

export function extractToolOutput(record: Record<string, unknown>): string | undefined {
  const direct =
    record.toolOutput ?? record.output ?? record.aggregated_output ?? record.stdout ?? record.content;
  return textValue(direct);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const part of value) {
      if (typeof part === 'string' && part.length > 0) parts.push(part);
      else if (isRecord(part)) {
        const text = stringField(part, 'text', 'content', 'output');
        if (text) parts.push(text);
      }
    }
    return parts.length > 0 ? parts.join('') : undefined;
  }
  if (isRecord(value)) return stringField(value, 'text', 'content', 'output', 'toolOutput');
  return undefined;
}

export function extractMetrics(record: Record<string, unknown>): {
  durationMs?: number;
  costUsd?: number;
} {
  const durationRaw = numberField(record, 'durationMs', 'duration_ms', 'duration');
  const costUsd = numberField(record, 'costUsd', 'cost_usd', 'total_cost_usd', 'cost');
  const durationMs = durationRaw !== undefined && durationRaw >= 0 ? durationRaw : undefined;
  return {
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export function extractMetricsDeep(record: Record<string, unknown>): {
  durationMs?: number;
  costUsd?: number;
} {
  const usage = isRecord(record.usage) ? extractMetrics(record.usage) : {};
  return { ...usage, ...extractMetrics(record) };
}

export function collectFilePaths(record: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !paths.includes(value)) paths.push(value);
  };
  add(record.filePath);
  add(record.file);
  add(record.path);
  for (const list of [record.files, record.changes, record.edits]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') add(entry);
      else if (isRecord(entry)) add(entry.path ?? entry.filePath ?? entry.file);
    }
  }
  return paths;
}

export function doneEvent(
  sessionId: string,
  record: Record<string, unknown>,
  text?: string,
): UnifiedStreamEvent {
  return createStreamEvent(sessionId, 'done', {
    ...extractMetricsDeep(record),
    ...(text ? { text } : {}),
  });
}

export function fileEditEvents(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  return collectFilePaths(record).map((filePath) => createStreamEvent(sessionId, 'file_edit', { filePath }));
}

export function toolResultEvent(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent {
  const toolOutput = extractToolOutput(record);
  return createStreamEvent(sessionId, 'tool_result', toolOutput !== undefined ? { toolOutput } : {});
}

export function eventsForToolCall(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  const toolName = stringField(record, 'toolName', 'tool', 'name');
  if (!toolName) return [];
  const raw = record.toolArgs ?? record.args ?? record.input ?? record.arguments;
  const toolArgs = isRecord(raw) ? raw : undefined;
  const events: UnifiedStreamEvent[] = [
    createStreamEvent(sessionId, 'tool_call', {
      toolName,
      ...(toolArgs ? { toolArgs } : {}),
    }),
  ];
  const filePath = toolArgs ? stringField(toolArgs, 'file_path', 'filePath', 'path', 'file') : undefined;
  if (filePath && EDIT_TOOLS.has(toolName.toLowerCase())) {
    events.push(createStreamEvent(sessionId, 'file_edit', { filePath }));
  }
  return events;
}

export function errorEvent(record: Record<string, unknown>, sessionId: string, line: string): UnifiedStreamEvent {
  return createStreamEvent(sessionId, 'error', {
    error: stringField(record, 'error', 'message', 'text') ?? line,
  });
}
