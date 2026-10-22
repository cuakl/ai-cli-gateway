import { lstat, rm, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@gateway/shared-types';
import type { ProcessManager } from '../session/manager.js';
import { BinaryResolver, describeAuthFailure } from '../utils/binary.js';
import { BaseAdapter } from './base.js';
import { readCursorIdeAccessToken } from './cursor-auth.js';
import {
  collectFilePaths,
  doneEvent,
  errorEvent,
  eventType,
  eventsForToolCall,
  extractText,
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

/** Session directory names we are willing to delete. Rejects `.`, `..`, and path separators. */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const EDIT_TOOL_CASES = new Set([
  'edittoolcall',
  'writetoolcall',
  'strreplacetoolcall',
  'applypatchtoolcall',
]);

/**
 * Cursor agent CLI (`agent` / `cursor-agent`).
 *
 * Headless invocation:
 * `agent -p --output-format stream-json --stream-partial-output --trust --workspace <cwd> --force -- <prompt>`
 * `-p` is print mode, not the prompt. The prompt is a positional argument
 * after `--`, so a leading dash is not parsed as a flag. `--workspace` and the
 * child process cwd are both the project. `--trust` skips the interactive
 * workspace prompt. `--stream-partial-output` emits text as it arrives.
 * `--force` is omitted when `yolo` is explicitly false.
 * Ephemeral runs delete `.cursor/worktrees/<sessionId>` and `.cursor/sessions/<sessionId>`
 * under the workspace after the process settles.
 */
/**
 * Cursor's stream-json mode emits each assistant message twice: a partial
 * with `timestamp_ms`, then the same text again without it. Later partials
 * are deltas. A repeated copy of text already shown is dropped.
 */
export class CursorLineParser {
  private readonly text = new Map<string, string>();

  parse(line: string, sessionId: string): UnifiedStreamEvent[] {
    const events = parseCursorLine(line, sessionId);
    const record = parseJsonRecord(line);
    if (!record || eventType(record) !== 'assistant') return events;

    const chunk = events.find((event) => event.type === 'chunk')?.payload.text ?? '';
    const seen = this.text.get(sessionId);
    const partial = typeof record.timestamp_ms === 'number';
    if (seen !== undefined && (!partial || (chunk.length > 0 && seen.endsWith(chunk)))) {
      return events.filter((event) => event.type !== 'chunk');
    }
    if (chunk) this.text.set(sessionId, (seen ?? '') + chunk);
    return events;
  }

  reset(sessionId: string): void {
    this.text.delete(sessionId);
  }
}

export class CursorAdapter extends BaseAdapter {
  override readonly provider = 'cursor' as const;
  private readonly lines = new CursorLineParser();

  constructor(
    binaries?: BinaryResolver,
    processes?: ProcessManager,
    private readonly readIdeToken: () => Promise<string | null> = readCursorIdeAccessToken,
  ) {
    super(binaries, processes);
  }

  override buildArgs(options: PromptOptions): string[] {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--workspace',
      options.cwd,
    ];
    if (options.yolo !== false) args.push('--force');
    args.push('--', options.prompt);
    return args;
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return this.lines.parse(line, sessionId);
  }

  protected override parseStderrLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    const text = stripAnsi(line).trim();
    if (!text || describeAuthFailure(this.provider, text)) return [];
    return [createStreamEvent(sessionId, 'error', { error: text })];
  }

  /**
   * The IDE and the CLI keep separate logins. When the CLI has no token of
   * its own, pass the IDE access token as `CURSOR_AUTH_TOKEN`. The value is
   * only placed in the child environment, never in argv, events, or logs.
   * An explicit `CURSOR_AUTH_TOKEN` or `CURSOR_API_KEY` on the gateway wins.
   */
  protected override async executionEnv(): Promise<NodeJS.ProcessEnv | undefined> {
    if (process.env.CURSOR_AUTH_TOKEN || process.env.CURSOR_API_KEY) return undefined;
    try {
      const token = await this.readIdeToken();
      if (!token) return undefined;
      return { CURSOR_AUTH_TOKEN: token };
    } catch {
      return undefined;
    }
  }

  protected override async afterExecute(options: PromptOptions, sessionId: string): Promise<void> {
    this.lines.reset(sessionId);
    if (options.ephemeral !== true) return;
    await cleanupCursorEphemeral(options.cwd, sessionId);
  }
}

export function parseCursorLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) {
    const text = stripAnsi(line).trim();
    if (!text || describeAuthFailure('cursor', text)) return [];
    return [textChunk(sessionId, text)];
  }

  const type = eventType(record);
  if (type === 'system' || type === 'user' || type === 'thinking' || type === 'retry' || type === 'connection') {
    return [];
  }
  if (type === 'error') return [errorEvent(record, sessionId, line)];
  if (type === 'tool_call') return cursorToolEvents(record, sessionId);
  if (type === 'assistant' || isTextType(type)) {
    const text = extractText(record);
    return text ? [textChunk(sessionId, text)] : [];
  }
  if (type === 'result' && stringField(record, 'subtype')) return cursorStreamResult(record, sessionId);
  if (isToolCallType(type)) {
    const events = eventsForToolCall(record, sessionId);
    return events.length > 0 ? events : [];
  }
  if (isToolResultType(type)) return [toolResultEvent(record, sessionId)];
  if (isFileType(type)) {
    const edits = fileEditEvents(record, sessionId);
    return edits.length > 0 ? edits : [];
  }
  if (isDoneType(type) || isCursorAggregate(record, type)) return cursorAggregate(record, sessionId);

  const text = extractText(record);
  return text ? [textChunk(sessionId, text)] : [];
}

function cursorStreamResult(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  const events: UnifiedStreamEvent[] = [];
  const subtype = (stringField(record, 'subtype') ?? '').toLowerCase();
  if (subtype === 'error' || record.is_error === true) {
    const message = stringField(record, 'error', 'result', 'message') ?? 'Cursor agent failed';
    events.push(createStreamEvent(sessionId, 'error', { error: message }));
  }
  events.push(...fileEditEvents(record, sessionId));
  events.push(doneEvent(sessionId, record));
  return events;
}

function cursorToolEvents(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  const located = locateCursorTool(isRecord(record.tool_call) ? record.tool_call : record);
  if (!located) {
    const generic = eventsForToolCall(record, sessionId);
    return generic.length > 0 ? generic : [];
  }
  const args = located.args;
  const events: UnifiedStreamEvent[] = [
    createStreamEvent(sessionId, 'tool_call', {
      toolName: located.name,
      ...(args ? { toolArgs: args } : {}),
    }),
  ];
  if (located.path && EDIT_TOOL_CASES.has(located.name.toLowerCase())) {
    events.push(createStreamEvent(sessionId, 'file_edit', { filePath: located.path }));
  }
  return events;
}

function locateCursorTool(toolCall: Record<string, unknown>): {
  name: string;
  path?: string;
  args?: Record<string, unknown>;
} | null {
  const tool = isRecord(toolCall.tool) ? toolCall.tool : undefined;
  if (tool) {
    const name = stringField(tool, 'case');
    const value = isRecord(tool.value) ? tool.value : undefined;
    const args = value && isRecord(value.args) ? value.args : undefined;
    const path = args ? stringField(args, 'path', 'filePath', 'file_path', 'target_file') : undefined;
    if (name) {
      return { name, ...(path ? { path } : {}), ...(args ? { args } : {}) };
    }
  }
  for (const [key, value] of Object.entries(toolCall)) {
    if (!key.endsWith('ToolCall') || !isRecord(value)) continue;
    const args = isRecord(value.args) ? value.args : undefined;
    const path = args ? stringField(args, 'path', 'filePath', 'file_path', 'target_file') : undefined;
    return { name: key, ...(path ? { path } : {}), ...(args ? { args } : {}) };
  }
  return null;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function isCursorAggregate(record: Record<string, unknown>, type: string): boolean {
  if (type) return false;
  return (
    collectFilePaths(record).length > 0 ||
    typeof record.result === 'string' ||
    Array.isArray(record.changes) ||
    Array.isArray(record.files)
  );
}

function cursorAggregate(record: Record<string, unknown>, sessionId: string): UnifiedStreamEvent[] {
  const events: UnifiedStreamEvent[] = [];
  const spoken = stringField(record, 'message', 'text', 'content');
  const summary = stringField(record, 'result', 'summary');
  if (spoken) events.push(textChunk(sessionId, spoken));
  else if (summary) events.push(textChunk(sessionId, summary));
  events.push(...fileEditEvents(record, sessionId));
  const doneText = summary && summary !== spoken ? summary : undefined;
  events.push(doneEvent(sessionId, record, doneText));
  return events;
}

export async function cleanupCursorEphemeral(cwd: string, sessionId: string): Promise<void> {
  if (!isSafeSessionId(sessionId)) return;
  const root = resolve(cwd);
  for (const bucket of ['worktrees', 'sessions'] as const) {
    const target = resolve(root, '.cursor', bucket, sessionId);
    if (!isInside(root, target)) continue;
    await removeIfExists(target);
  }
}

function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId) && !sessionId.includes('..');
}

function isInside(parent: string, target: string): boolean {
  const root = resolve(parent);
  const child = resolve(target);
  if (child === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return child.startsWith(prefix);
}

async function removeIfExists(target: string): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    await unlink(target);
    return;
  }
  await rm(target, { recursive: true, force: true });
}
