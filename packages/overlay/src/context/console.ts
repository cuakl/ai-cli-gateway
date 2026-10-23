import type { FrontendConsoleLog } from '@aidev/protocol';
import { createRingBuffer, type RingBuffer } from './ring.js';

type ConsoleLevel = FrontendConsoleLog['level'];

const ARG_LIMIT = 2_000;

const logs: RingBuffer<FrontendConsoleLog> = createRingBuffer();
let installed = false;
let capturing = false;
let errorHook: ((entry: FrontendConsoleLog) => void) | null = null;
let invoke: Record<ConsoleLevel, (...args: unknown[]) => void> | null = null;
let restore: (() => void) | null = null;

export function setConsoleErrorHook(hook: ((entry: FrontendConsoleLog) => void) | null): void {
  errorHook = hook;
}

export function installConsoleCapture(): void {
  if (installed || typeof console === 'undefined') return;
  const saved = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  invoke = {
    log: saved.log.bind(console),
    warn: saved.warn.bind(console),
    error: saved.error.bind(console),
  };
  console.log = wrap('log') as typeof console.log;
  console.warn = wrap('warn') as typeof console.warn;
  console.error = wrap('error') as typeof console.error;
  restore = () => {
    console.log = saved.log;
    console.warn = saved.warn;
    console.error = saved.error;
  };
  installed = true;
}

export function uninstallConsoleCapture(): void {
  if (!installed) return;
  restore?.();
  restore = null;
  invoke = null;
  errorHook = null;
  installed = false;
  logs.clear();
}

export function getConsoleLogs(): FrontendConsoleLog[] {
  return logs.snapshot();
}

function wrap(level: ConsoleLevel): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (!capturing) {
      capturing = true;
      try {
        const entry: FrontendConsoleLog = {
          level,
          args: args.map((arg) => formatArg(arg)),
          timestamp: Date.now(),
        };
        logs.push(entry);
        if (level === 'error') errorHook?.(entry);
      } catch {
        // A broken collector must not take down the page console.
      } finally {
        capturing = false;
      }
    }
    invoke?.[level].apply(console, args);
  };
}

function formatArg(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || value == null) text = String(value);
  else if (value instanceof Error) text = value.stack || value.message;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > ARG_LIMIT ? `${text.slice(0, ARG_LIMIT)}…` : text;
}
