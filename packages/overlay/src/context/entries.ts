import type { FailedNetworkRequest, FrontendError } from '@aidev/protocol';
import { getConsoleLogs } from './console.js';
import { getErrors } from './errors.js';
import { getStoredFailedNetworkRequests } from './network.js';

export type ConsoleFilter = 'all' | 'error' | 'warn' | 'network' | 'vite';

export interface ConsoleSource {
  file: string;
  line?: number;
  column?: number;
}

export interface ConsoleEntry {
  id: string;
  filter: Exclude<ConsoleFilter, 'all'> | 'log';
  timestamp: number;
  message: string;
  source?: ConsoleSource;
  stack?: string;
  fixable: boolean;
  error?: FrontendError;
  request?: FailedNetworkRequest;
}

const STACK_FRAME = /(?:https?:\/\/[^\s)]+?|\/?[A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/;
const MESSAGE_WHERE = /\(([^()\s]+):(\d+):(\d+)\)\s*$/;

export function listConsoleEntries(): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  const logs = getConsoleLogs();
  const consoleErrorKeys = new Set<string>();

  for (const log of logs) {
    const text = log.args.join(' ');
    if (log.level === 'error') consoleErrorKeys.add(`${log.timestamp}:${text}`);
    const filter: ConsoleEntry['filter'] =
      log.level === 'warn' ? 'warn' : log.level === 'error' ? 'error' : 'log';
    entries.push({
      id: `log:${log.level}:${log.timestamp}:${text}`,
      filter,
      timestamp: log.timestamp,
      message: text,
      source: sourceFromText(text),
      ...(log.level === 'error' ? { stack: text } : {}),
      fixable: log.level === 'error',
      ...(log.level === 'error'
        ? { error: { type: 'console_error', message: text, timestamp: log.timestamp } }
        : {}),
    });
  }

  for (const error of getErrors()) {
    if (error.type === 'console_error' && consoleErrorKeys.has(`${error.timestamp}:${error.message}`)) continue;
    entries.push({
      id: `err:${error.type}:${error.timestamp}:${error.message}`,
      filter: error.type === 'vite' ? 'vite' : 'error',
      timestamp: error.timestamp,
      message: error.message,
      source: sourceFromError(error),
      ...(error.stack ? { stack: error.stack } : {}),
      fixable: true,
      error,
    });
  }

  for (const request of getStoredFailedNetworkRequests()) {
    const method = request.method ?? 'GET';
    const message = `${method} ${request.status} ${request.url}`;
    entries.push({
      id: `net:${request.timestamp}:${message}`,
      filter: 'network',
      timestamp: request.timestamp,
      message,
      fixable: true,
      request,
      ...(request.bodyPreview ? { stack: request.bodyPreview } : {}),
    });
  }

  entries.sort((left, right) => left.timestamp - right.timestamp);
  return entries;
}

export function filterConsoleEntries(
  entries: readonly ConsoleEntry[],
  filter: ConsoleFilter,
): ConsoleEntry[] {
  if (filter === 'all') return [...entries];
  return entries.filter((entry) => entry.filter === filter);
}

export function parseSourceLocation(text: string): ConsoleSource | undefined {
  return sourceFromText(text);
}

function sourceFromError(error: FrontendError): ConsoleSource | undefined {
  return sourceFromText(error.message) ?? (error.stack ? sourceFromText(error.stack) : undefined);
}

function sourceFromText(text: string): ConsoleSource | undefined {
  const where = MESSAGE_WHERE.exec(text);
  if (where?.[1]) {
    return {
      file: toProjectPath(where[1]),
      line: Number(where[2]),
      column: Number(where[3]),
    };
  }
  const frame = STACK_FRAME.exec(text);
  if (!frame) return undefined;
  const raw = frame[0]?.replace(/:\d+(?::\d+)?$/, '') ?? '';
  const file = toProjectPath(raw);
  if (!file) return undefined;
  return {
    file,
    line: frame[1] ? Number(frame[1]) : undefined,
    column: frame[2] ? Number(frame[2]) : undefined,
  };
}

export function toProjectPath(value: string): string {
  let path = value.replace(/\\/g, '/');
  try {
    const url = new URL(path, typeof window !== 'undefined' ? window.location.href : undefined);
    path = url.pathname;
  } catch {
    // Already a path.
  }
  path = path.replace(/[?#].*$/, '');
  const fsAt = path.indexOf('/@fs/');
  if (fsAt >= 0) return path.slice(fsAt + '/@fs/'.length).replace(/^\//, '');
  for (const marker of ['/src/', '/apps/', '/packages/']) {
    const at = path.indexOf(marker);
    if (at >= 0) return path.slice(at + 1);
  }
  return path.replace(/^\//, '');
}
