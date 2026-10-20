import { lstat, rm, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { PromptOptions, UnifiedStreamEvent } from '@gateway/shared-types';
import { BaseAdapter } from './base.js';
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

/**
 * Cursor agent CLI (`agent`).
 *
 * Headless invocation:
 * `agent -p "<prompt>" --output-format json --workspace <cwd> --force`
 * `--force` is omitted when `yolo` is explicitly false. `--yolo` is the same switch.
 * Ephemeral runs delete `.cursor/worktrees/<sessionId>` and `.cursor/sessions/<sessionId>`
 * under the workspace after the process settles.
 */
export class CursorAdapter extends BaseAdapter {
  override readonly provider = 'cursor' as const;

  override buildArgs(options: PromptOptions): string[] {
    const args = ['-p', options.prompt, '--output-format', 'json', '--workspace', options.cwd];
    if (options.yolo !== false) args.push('--force');
    return args;
  }

  protected override parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return parseCursorLine(line, sessionId);
  }

  protected override async afterExecute(options: PromptOptions, sessionId: string): Promise<void> {
    if (options.ephemeral !== true) return;
    await cleanupCursorEphemeral(options.cwd, sessionId);
  }
}

export function parseCursorLine(line: string, sessionId: string): UnifiedStreamEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [textChunk(sessionId, line)];

  const type = eventType(record);
  if (type === 'error') return [errorEvent(record, sessionId, line)];
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
  if (isDoneType(type) || isCursorAggregate(record, type)) return cursorAggregate(record, sessionId);

  return [textChunk(sessionId, extractText(record) ?? line)];
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
