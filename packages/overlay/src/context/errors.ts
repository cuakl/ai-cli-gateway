import type { FrontendError } from '@aidev/protocol';
import { notifyContext } from './bus.js';
import { redactUrl } from './redact.js';
import { createRingBuffer, type RingBuffer } from './ring.js';

export interface EarlyBufferedError {
  message?: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  timestamp?: number;
  tag?: string;
  src?: string;
}

interface EarlyErrorBuffer {
  errors: EarlyBufferedError[];
}

const errors: RingBuffer<FrontendError> = createRingBuffer();
let installed = false;
let previousOnError: OnErrorEventHandler = null;
let runStartedAt = 0;

export function recordError(error: FrontendError): void {
  if (hasDuplicate(error)) return;
  errors.push(error);
  notifyContext();
}

export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  previousOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    recordRuntimeError(message, source, lineno, colno, error);
    if (typeof previousOnError === 'function') {
      const result = previousOnError.call(window, message, source, lineno, colno, error);
      return result === true;
    }
    return false;
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onResourceError, true);
  drainEarlyErrors();
}

export function uninstallErrorCapture(): void {
  if (!installed || typeof window === 'undefined') return;
  window.onerror = previousOnError;
  window.removeEventListener('unhandledrejection', onRejection);
  window.removeEventListener('error', onResourceError, true);
  previousOnError = null;
  installed = false;
  runStartedAt = 0;
  errors.clear();
}

export function getErrors(): FrontendError[] {
  return errors.snapshot();
}

export function clearErrorsMatching(predicate: (error: FrontendError) => boolean): void {
  if (errors.removeMatching(predicate) > 0) notifyContext();
}

export function markRunStart(now = Date.now()): void {
  runStartedAt = now;
  notifyContext();
}

export function getRunStartedAt(): number {
  return runStartedAt;
}

function drainEarlyErrors(): void {
  const buffer = readEarlyBuffer();
  if (!buffer) return;
  const pending = buffer.errors.splice(0, buffer.errors.length);
  for (const entry of pending) {
    const recorded = fromEarlyError(entry);
    if (recorded) recordError(recorded);
  }
}

function readEarlyBuffer(): EarlyErrorBuffer | null {
  const host = window as Window & { __AI_DEVTOOLS_EARLY__?: EarlyErrorBuffer };
  const buffer = host.__AI_DEVTOOLS_EARLY__;
  if (!buffer || !Array.isArray(buffer.errors)) return null;
  return buffer;
}

function fromEarlyError(entry: EarlyBufferedError): FrontendError | null {
  const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();
  if (entry.tag) {
    const src = typeof entry.src === 'string' ? redactUrl(entry.src) : '';
    return {
      type: 'runtime',
      message: src ? `Failed to load ${entry.tag} ${src}` : `Failed to load ${entry.tag}`,
      timestamp,
    };
  }
  const text = String(entry.message ?? 'Script error');
  const file = typeof entry.filename === 'string' ? entry.filename : undefined;
  const line = entry.lineno;
  const column = entry.colno;
  const where = file ? `${redactUrl(file)}:${line ?? 0}:${column ?? 0}` : undefined;
  const stack = typeof entry.stack === 'string' && entry.stack.length > 0 ? entry.stack : where;
  return {
    type: 'runtime',
    message: where ? `${text} (${where})` : text,
    ...(stack ? { stack } : {}),
    timestamp,
  };
}

function onRejection(event: Event): void {
  const reason = (event as PromiseRejectionEvent).reason;
  const details = describeReason(reason);
  recordError({
    type: 'unhandled_rejection',
    message: details.message,
    ...(details.stack ? { stack: details.stack } : {}),
    timestamp: Date.now(),
  });
}

function onResourceError(event: Event): void {
  const target = event.target;
  if (!target || target === window || !(target instanceof Element)) return;
  const tag = target.tagName;
  if (tag !== 'IMG' && tag !== 'SCRIPT' && tag !== 'LINK') return;
  const srcAttr =
    target.getAttribute('src') ??
    target.getAttribute('href') ??
    ('src' in target ? String((target as HTMLImageElement).src ?? '') : '') ??
    ('href' in target ? String((target as HTMLLinkElement).href ?? '') : '');
  const src = srcAttr ? redactUrl(srcAttr) : '';
  recordError({
    type: 'runtime',
    message: src ? `Failed to load ${tag} ${src}` : `Failed to load ${tag}`,
    timestamp: Date.now(),
  });
}

function recordRuntimeError(
  message: Event | string,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error,
): void {
  const text = typeof message === 'string' ? message : message instanceof ErrorEvent ? message.message : 'Script error';
  const file = typeof message === 'string' ? source : message instanceof ErrorEvent ? message.filename : source;
  const line = typeof message === 'string' ? lineno : message instanceof ErrorEvent ? message.lineno : lineno;
  const column = typeof message === 'string' ? colno : message instanceof ErrorEvent ? message.colno : colno;
  const thrown = typeof message === 'string' ? error : message instanceof ErrorEvent ? asError(message.error) : error;
  const where = file ? `${redactUrl(file)}:${line ?? 0}:${column ?? 0}` : undefined;
  const stack = thrown?.stack ?? where;
  recordError({
    type: 'runtime',
    message: where ? `${text} (${where})` : text,
    ...(stack ? { stack } : {}),
    timestamp: Date.now(),
  });
}

function hasDuplicate(error: FrontendError): boolean {
  return errors.snapshot().some((existing) => errorKey(existing) === errorKey(error));
}

function errorKey(error: FrontendError): string {
  return `${error.type}\n${error.message}\n${error.stack ?? ''}\n${error.timestamp}`;
}

function asError(value: unknown): Error | undefined {
  return value instanceof Error ? value : undefined;
}

function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: reason.message || 'Unhandled rejection',
      ...(reason.stack ? { stack: reason.stack } : {}),
    };
  }
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? 'Unhandled rejection' };
  } catch {
    return { message: String(reason) };
  }
}
