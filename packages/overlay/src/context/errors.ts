import type { FrontendError } from '@aidev/protocol';
import { notifyContext } from './bus.js';
import { createRingBuffer, type RingBuffer } from './ring.js';

const errors: RingBuffer<FrontendError> = createRingBuffer();
let installed = false;
let previousOnError: OnErrorEventHandler = null;

export function recordError(error: FrontendError): void {
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
}

export function uninstallErrorCapture(): void {
  if (!installed || typeof window === 'undefined') return;
  window.onerror = previousOnError;
  window.removeEventListener('unhandledrejection', onRejection);
  previousOnError = null;
  installed = false;
  errors.clear();
}

export function getErrors(): FrontendError[] {
  return errors.snapshot();
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
  const where = file ? `${file}:${line ?? 0}:${column ?? 0}` : undefined;
  const stack = thrown?.stack ?? where;
  recordError({
    type: 'runtime',
    message: where ? `${text} (${where})` : text,
    ...(stack ? { stack } : {}),
    timestamp: Date.now(),
  });
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
