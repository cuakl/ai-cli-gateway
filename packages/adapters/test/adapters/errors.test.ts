import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAdapter, ProcessManager, ProcessTimeoutError } from '../../src/index.js';
import { collectEvents, ensureFixtures, fixture, resolverFor } from './helpers.js';

describe('adapter error normalization', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('turns mock stderr and a non-zero exit into error events', async () => {
    const adapter = createAdapter('antigravity', {
      binaries: resolverFor('antigravity', fixture('mock-error.js')),
      processes: new ProcessManager(),
    });
    const { events, onEvent } = collectEvents();
    const result = await adapter.execute(
      { prompt: 'fail', cwd: tmpdir(), sessionId: 'sess-error' },
      onEvent,
    );

    expect(result).toEqual({ exitCode: 1, summary: '' });
    expect(events.map((event) => event.type)).toEqual(['init', 'error', 'error', 'done']);
    expect(events[1]?.payload.error).toBe('mock cli failed');
    expect(events[2]?.payload.error).toBe('Process exited with code 1');
    expect(events.every((event) => event.sessionId === 'sess-error')).toBe(true);
  });

  it('kills a hung mock CLI when the timeout elapses', async () => {
    const adapter = createAdapter('claude', {
      binaries: resolverFor('claude', fixture('mock-hang.js')),
      processes: new ProcessManager(),
    });
    const started = Date.now();
    await expect(
      adapter.execute({ prompt: 'hang', cwd: tmpdir(), sessionId: 'sess-hang', timeoutMs: 400 }, () => {}),
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
