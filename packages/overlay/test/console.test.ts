import { afterEach, describe, expect, it } from 'vitest';
import { CONTEXT_BUFFER_LIMIT } from '../src/context/ring.js';
import {
  getConsoleLogs,
  installConsoleCapture,
  uninstallConsoleCapture,
} from '../src/context/console.js';

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('console capture', () => {
  afterEach(() => {
    uninstallConsoleCapture();
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('keeps the original console methods and records log, warn, and error', () => {
    const calls: string[] = [];
    console.log = ((message: string) => {
      calls.push(message);
    }) as typeof console.log;
    console.warn = (() => undefined) as typeof console.warn;
    console.error = (() => undefined) as typeof console.error;
    installConsoleCapture();

    console.log('hello', { a: 1 });
    console.warn('careful');
    console.error(new Error('boom'));

    expect(calls).toEqual(['hello']);
    expect(CONTEXT_BUFFER_LIMIT).toBe(50);
    const entries = getConsoleLogs();
    expect(entries.map((entry) => entry.level)).toEqual(['log', 'warn', 'error']);
    expect(entries[0]).toMatchObject({ args: ['hello', '{"a":1}'], timestamp: expect.any(Number) });
    expect(entries[1]?.args).toEqual(['careful']);
    expect(entries[2]?.args[0]).toContain('boom');
  });

  it('keeps the last 50 entries', () => {
    console.warn = (() => undefined) as typeof console.warn;
    installConsoleCapture();
    for (let index = 0; index < 55; index += 1) console.warn(`m${index}`);
    const entries = getConsoleLogs();
    expect(entries).toHaveLength(50);
    expect(entries[0]?.args).toEqual(['m5']);
    expect(entries[49]?.args).toEqual(['m54']);
  });

  it('restores the original methods on uninstall', () => {
    const original = console.log;
    installConsoleCapture();
    expect(console.log).not.toBe(original);
    uninstallConsoleCapture();
    expect(console.log).toBe(original);
    expect(getConsoleLogs()).toEqual([]);
  });
});
