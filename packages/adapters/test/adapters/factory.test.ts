import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProviderType } from '../../src/index.js';
import {
  AntigravityAdapter,
  BinaryResolver,
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  ProcessManager,
  createAdapter,
  getAvailableAdapters,
} from '../../src/index.js';
import { waitFor } from '../helpers.js';
import { ensureFixtures, fixture, resolverFor } from './helpers.js';

describe('adapter factory', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('dispatches each provider to its adapter class', () => {
    expect(createAdapter('cursor')).toBeInstanceOf(CursorAdapter);
    expect(createAdapter('antigravity')).toBeInstanceOf(AntigravityAdapter);
    expect(createAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(createAdapter('codex')).toBeInstanceOf(CodexAdapter);
    expect(createAdapter('cursor').provider).toBe('cursor');
    expect(createAdapter('antigravity').provider).toBe('antigravity');
    expect(createAdapter('claude').provider).toBe('claude');
    expect(createAdapter('codex').provider).toBe('codex');
    expect(() => createAdapter('nope' as ProviderType)).toThrow('Unsupported provider: nope');
  });

  it('reports availability from the shared binary resolver', async () => {
    const binaries = new BinaryResolver({
      which: async (command) => (command === 'agy' ? '/opt/bin/agy' : null),
      isExecutable: async (filePath) => filePath === '/opt/bin/agy',
    });
    await expect(getAvailableAdapters({ binaries })).resolves.toEqual([
      { provider: 'cursor', available: false, binaryPath: null },
      { provider: 'antigravity', available: true, binaryPath: '/opt/bin/agy' },
      { provider: 'claude', available: false, binaryPath: null },
      { provider: 'codex', available: false, binaryPath: null },
    ]);

    const detected = await getAvailableAdapters();
    expect(detected.map((item) => item.provider)).toEqual(['cursor', 'antigravity', 'claude', 'codex']);
    for (const item of detected) {
      expect(item.available).toBe(item.binaryPath !== null);
      expect(item.binaryPath === null || typeof item.binaryPath === 'string').toBe(true);
    }
  });

  it('uses the process manager passed to createAdapter', async () => {
    const processes = new ProcessManager();
    const sessionId = 'factory-kill';
    const adapter = createAdapter('codex', {
      binaries: resolverFor('codex', fixture('mock-hang.js')),
      processes,
    });
    const pending = adapter.execute(
      { prompt: 'hang', cwd: tmpdir(), sessionId, timeoutMs: 30_000 },
      () => {},
    );

    await waitFor(() => processes.has(sessionId));
    await expect(adapter.kill(sessionId)).resolves.toBe(true);
    await expect(pending).resolves.toMatchObject({ exitCode: 1 });
    expect(processes.has(sessionId)).toBe(false);
  });
});
