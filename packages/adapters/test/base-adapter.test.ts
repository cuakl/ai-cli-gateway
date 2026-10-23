import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BaseAdapter } from '../src/adapters/base.js';
import { ProcessManager } from '../src/session/manager.js';
import { BinaryNotFoundError, BinaryResolver } from '../src/utils/binary.js';
import type { PromptOptions, UnifiedStreamEvent } from '../src/index.js';
import { isProcessAlive, waitFor } from './helpers.js';

class NodeAdapter extends BaseAdapter {
  override readonly provider = 'codex' as const;

  override buildArgs(options: PromptOptions): string[] {
    return ['-e', 'process.stdout.write(process.argv[1] ?? "")', options.prompt];
  }
}

class SleepAdapter extends BaseAdapter {
  override readonly provider = 'codex' as const;

  override buildArgs(): string[] {
    return ['-e', 'setInterval(() => {}, 1000)'];
  }
}

function nodeBackedResolver(): BinaryResolver {
  return new BinaryResolver({
    candidates: {
      codex: { commands: ['node'], paths: [process.execPath] },
    },
  });
}

describe('BaseAdapter', () => {
  it('streams init, chunk, and done for a headless command', async () => {
    const adapter = new NodeAdapter(nodeBackedResolver(), new ProcessManager());
    const events: UnifiedStreamEvent[] = [];
    const prompt = 'hello; echo injected';

    const result = await adapter.execute(
      { prompt, cwd: tmpdir(), sessionId: 'sess-echo' },
      (event) => events.push(event),
    );

    expect(result).toEqual({ exitCode: 0, summary: prompt });
    expect(events.map((event) => event.type)).toEqual(['init', 'chunk', 'done']);
    expect(events[0]?.payload.text).toBe('codex session started');
    expect(events.find((event) => event.type === 'chunk')?.payload.segment).toBe(0);
    expect(events.every((event) => event.sessionId === 'sess-echo')).toBe(true);
    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.getBinaryPath()).resolves.toMatch(/\/node$/);
  });

  it('throws a setup error when the provider binary is missing', async () => {
    const resolver = new BinaryResolver({
      which: async () => null,
      candidates: {
        cursor: {
          commands: ['cursor-agent-not-installed'],
          paths: ['/usr/local/bin/cursor-agent-not-installed'],
        },
      },
    });
    const adapter = new (class extends BaseAdapter {
      override readonly provider = 'cursor' as const;
      override buildArgs(): string[] {
        return [];
      }
    })(resolver, new ProcessManager());

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.getBinaryPath()).rejects.toBeInstanceOf(BinaryNotFoundError);
    await expect(adapter.getBinaryPath()).rejects.toThrow(/agent/);
    await expect(adapter.kill('missing-session')).resolves.toBe(false);
  });

  it('kills a session started by execute', async () => {
    const processes = new ProcessManager();
    const adapter = new SleepAdapter(nodeBackedResolver(), processes);
    const sessionId = 'sess-sleep';
    let pid: number | undefined;
    const pending = adapter.execute(
      { prompt: 'sleep', cwd: tmpdir(), sessionId, timeoutMs: 30_000 },
      () => {
        pid ??= processes.get(sessionId)?.pid;
      },
    );

    await waitFor(() => processes.get(sessionId)?.pid != null);
    pid = processes.get(sessionId)?.pid;
    if (pid == null) throw new Error('adapter process did not start');

    await expect(adapter.kill(sessionId)).resolves.toBe(true);
    await expect(pending).resolves.toMatchObject({ exitCode: 1 });
    expect(isProcessAlive(pid)).toBe(false);
  });
});
