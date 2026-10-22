import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliAuthError, ProcessManager, ProcessTimeoutError } from '../src/index.js';
import type { UnifiedStreamEvent } from '../src/index.js';
import { isProcessAlive, waitFor } from './helpers.js';

function nodeArgs(source: string, ...args: string[]): string[] {
  return ['-e', source, ...args];
}

function trackEvents(): { events: UnifiedStreamEvent[]; onEvent: (event: UnifiedStreamEvent) => void } {
  const events: UnifiedStreamEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

describe('ProcessManager', () => {
  it('emits stdout lines and a done event', async () => {
    const manager = new ProcessManager();
    const sessionId = randomUUID();
    const { events, onEvent } = trackEvents();

    const exitCode = await manager.start({
      sessionId,
      provider: 'codex',
      command: process.execPath,
      args: nodeArgs("process.stdout.write('hello\\nwor'); setTimeout(() => process.stdout.write('ld\\n'), 20)"),
      cwd: tmpdir(),
      onEvent,
    });

    expect(exitCode).toBe(0);
    expect(events.filter((event) => event.type === 'chunk').map((event) => event.payload.text)).toEqual([
      'hello',
      'world',
    ]);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.at(-1)?.payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(manager.has(sessionId)).toBe(false);
  });

  it('passes arguments literally and does not invoke a shell', async () => {
    const manager = new ProcessManager();
    const payload = 'hello; echo injected && rm -rf /';
    const { events, onEvent } = trackEvents();

    const exitCode = await manager.start({
      sessionId: randomUUID(),
      provider: 'codex',
      command: process.execPath,
      args: nodeArgs('process.stdout.write(process.argv[1] ?? "")', payload),
      cwd: tmpdir(),
      onEvent,
    });

    const text = events
      .filter((event) => event.type === 'chunk')
      .map((event) => event.payload.text ?? '')
      .join('');
    expect(exitCode).toBe(0);
    expect(text).toBe(payload);
  });

  it('reports stderr and a non-zero exit code', async () => {
    const manager = new ProcessManager();
    const { events, onEvent } = trackEvents();

    const exitCode = await manager.start({
      sessionId: randomUUID(),
      provider: 'claude',
      command: process.execPath,
      args: nodeArgs("process.stderr.write('boom\\n'); process.exit(2)"),
      cwd: tmpdir(),
      onEvent,
    });

    expect(exitCode).toBe(2);
    expect(events.some((event) => event.type === 'error' && event.payload.error === 'boom')).toBe(true);
    expect(events.some((event) => event.payload.error === 'Process exited with code 2')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects when cwd does not exist', async () => {
    const manager = new ProcessManager();
    const missing = join(tmpdir(), 'gateway-missing', randomUUID());
    const { events, onEvent } = trackEvents();

    await expect(
      manager.start({
        sessionId: randomUUID(),
        provider: 'cursor',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: missing,
        onEvent,
      }),
    ).rejects.toThrow(`cwd does not exist: ${missing}`);

    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('kills a running process', async () => {
    const manager = new ProcessManager();
    const sessionId = randomUUID();
    const pending = manager.start({
      sessionId,
      provider: 'codex',
      command: process.execPath,
      args: nodeArgs('setInterval(() => {}, 1000)'),
      cwd: tmpdir(),
      timeoutMs: 30_000,
      onEvent: () => {},
    });

    await waitFor(() => manager.get(sessionId)?.pid != null);
    const pid = manager.get(sessionId)?.pid;
    if (pid == null) throw new Error('process did not start');

    expect(manager.activeSessions()).toEqual([sessionId]);
    expect(manager.kill(sessionId)).toBe(true);
    await expect(pending).resolves.toBe(1);
    expect(isProcessAlive(pid)).toBe(false);
    expect(manager.kill(sessionId)).toBe(false);
  });

  it('terminates a hung process when the timeout elapses', async () => {
    const manager = new ProcessManager();
    const timeoutMs = 300;
    const started = Date.now();

    await expect(
      manager.start({
        sessionId: randomUUID(),
        provider: 'antigravity',
        command: process.execPath,
        args: nodeArgs('setInterval(() => {}, 1000)'),
        cwd: tmpdir(),
        timeoutMs,
        sigkillGraceMs: 2_000,
        onEvent: () => {},
      }),
    ).rejects.toBeInstanceOf(ProcessTimeoutError);

    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(elapsed).toBeLessThan(timeoutMs + 1_500);
  });

  it('sends SIGKILL when the process ignores SIGTERM', async () => {
    const manager = new ProcessManager();
    const sessionId = randomUUID();
    const pending = manager.start({
      sessionId,
      provider: 'antigravity',
      command: process.execPath,
      args: nodeArgs("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
      cwd: tmpdir(),
      timeoutMs: 300,
      sigkillGraceMs: 200,
      onEvent: () => {},
    });

    await waitFor(() => manager.get(sessionId)?.pid != null);
    const pid = manager.get(sessionId)?.pid;
    if (pid == null) throw new Error('process did not start');

    await expect(pending).rejects.toBeInstanceOf(ProcessTimeoutError);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('returns setup steps when the CLI asks for authentication', async () => {
    const manager = new ProcessManager();
    const { events, onEvent } = trackEvents();

    const failure = manager.start({
      sessionId: randomUUID(),
      provider: 'claude',
      command: process.execPath,
      args: nodeArgs("process.stderr.write('Please log in to continue\\n'); process.exit(1)"),
      cwd: tmpdir(),
      onEvent,
    });

    await expect(failure).rejects.toBeInstanceOf(CliAuthError);
    await expect(failure).rejects.toThrow(/not authenticated/);
    await expect(failure).rejects.toThrow(/claude/);
    const auth = events.find((event) => event.type === 'error' && event.payload.error?.includes('not authenticated'));
    expect(auth?.payload.error).toContain('1. Run `claude` and complete login.');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects a second process with the same session id', async () => {
    const manager = new ProcessManager();
    const sessionId = randomUUID();
    const first = manager.start({
      sessionId,
      provider: 'codex',
      command: process.execPath,
      args: nodeArgs('setInterval(() => {}, 1000)'),
      cwd: tmpdir(),
      timeoutMs: 30_000,
      onEvent: () => {},
    });

    await waitFor(() => manager.has(sessionId));
    await expect(
      manager.start({
        sessionId,
        provider: 'codex',
        command: process.execPath,
        args: nodeArgs('process.exit(0)'),
        cwd: tmpdir(),
        onEvent: () => {},
      }),
    ).rejects.toThrow(`Session ${sessionId} is already running`);

    expect(manager.kill(sessionId)).toBe(true);
    await expect(first).resolves.toBe(1);
  });
});
