import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCursorLine } from '../../src/adapters/cursor.js';
import { cleanupCursorEphemeral, createAdapter, CursorAdapter, ProcessManager } from '../../src/index.js';
import { collectEvents, ensureFixtures, fixture, resolverFor, tempWorkspace } from './helpers.js';

describe('CursorAdapter', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('builds print args and includes --force unless yolo is false', () => {
    const adapter = new CursorAdapter();
    expect(adapter.provider).toBe('cursor');
    const base = { prompt: 'make it emerald', cwd: '/work/demo' };
    expect(adapter.buildArgs(base)).toEqual([
      '-p',
      'make it emerald',
      '--output-format',
      'json',
      '--workspace',
      '/work/demo',
      '--force',
    ]);
    expect(adapter.buildArgs({ ...base, yolo: true })).toContain('--force');
    expect(adapter.buildArgs({ ...base, yolo: false })).not.toContain('--force');
    expect(adapter.buildArgs({ ...base, yolo: false })).not.toContain('--yolo');
  });

  it('maps JSON events, aggregate payloads, and plain text', () => {
    expect(parseCursorLine('cursor status', 'sess')[0]).toMatchObject({
      type: 'chunk',
      payload: { text: 'cursor status' },
    });
    expect(parseCursorLine('{not-json', 'sess')[0]?.type).toBe('chunk');

    const tool = parseCursorLine(
      JSON.stringify({ type: 'tool_call', name: 'Edit', arguments: { filePath: 'src/A.tsx' } }),
      'sess',
    );
    expect(tool.map((event) => event.type)).toEqual(['tool_call', 'file_edit']);
    expect(tool[0]?.payload.toolName).toBe('Edit');
    expect(tool[1]?.payload.filePath).toBe('src/A.tsx');

    const aggregate = parseCursorLine(
      JSON.stringify({ message: 'Updated hero button', files: ['src/A.tsx', 'src/A.tsx'], durationMs: 5, costUsd: 1 }),
      'sess',
    );
    expect(aggregate.map((event) => event.type)).toEqual(['chunk', 'file_edit', 'done']);
    expect(aggregate[2]?.payload).toEqual({ durationMs: 5, costUsd: 1 });
  });

  it('parses mock cursor JSON and dedupes file edits', async () => {
    const cwd = await tempWorkspace('gateway-cursor-run-');
    try {
      const adapter = createAdapter('cursor', {
        binaries: resolverFor('cursor', fixture('mock-cursor.js')),
        processes: new ProcessManager(),
      });
      const { events, onEvent } = collectEvents();
      const result = await adapter.execute(
        { prompt: 'update the hero', cwd, sessionId: 'sess-cursor' },
        onEvent,
      );

      expect(result.exitCode).toBe(0);
      expect(result.summary).toBe('cursor statusUpdated hero button');
      expect(events.map((event) => event.type)).toEqual([
        'init',
        'chunk',
        'chunk',
        'file_edit',
        'file_edit',
        'done',
        'done',
      ]);
      expect(events.filter((event) => event.type === 'file_edit').map((event) => event.payload.filePath)).toEqual([
        'src/components/Hero.tsx',
        'src/App.tsx',
      ]);
      expect(events.find((event) => event.type === 'done' && event.payload.costUsd === 0.003)?.payload).toEqual({
        durationMs: 120,
        costUsd: 0.003,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('removes session worktrees and sessions when ephemeral is set', async () => {
    const cwd = await tempWorkspace('gateway-cursor-ephemeral-');
    const sessionId = 'sess-1';
    try {
      await mkdir(join(cwd, '.cursor', 'worktrees', sessionId), { recursive: true });
      await mkdir(join(cwd, '.cursor', 'worktrees', 'keep'), { recursive: true });
      await mkdir(join(cwd, '.cursor', 'sessions', sessionId), { recursive: true });
      await writeFile(join(cwd, '.cursor', 'worktrees', sessionId, 'HEAD'), 'temp');
      await writeFile(join(cwd, '.cursor', 'worktrees', 'keep', 'HEAD'), 'stay');

      const adapter = createAdapter('cursor', {
        binaries: resolverFor('cursor', fixture('mock-cursor.js')),
        processes: new ProcessManager(),
      });
      const result = await adapter.execute({ prompt: 'edit', cwd, sessionId, ephemeral: true }, () => {});
      expect(result.exitCode).toBe(0);
      await expect(stat(join(cwd, '.cursor', 'worktrees', sessionId))).rejects.toThrow();
      await expect(stat(join(cwd, '.cursor', 'sessions', sessionId))).rejects.toThrow();
      expect(await readFile(join(cwd, '.cursor', 'worktrees', 'keep', 'HEAD'), 'utf8')).toBe('stay');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('leaves session artifacts in place when the run is not ephemeral', async () => {
    const cwd = await tempWorkspace('gateway-cursor-keep-');
    const sessionId = 'sess-keep';
    try {
      await mkdir(join(cwd, '.cursor', 'worktrees', sessionId), { recursive: true });
      await writeFile(join(cwd, '.cursor', 'worktrees', sessionId, 'HEAD'), 'stay');
      const adapter = createAdapter('cursor', {
        binaries: resolverFor('cursor', fixture('mock-cursor.js')),
        processes: new ProcessManager(),
      });
      await adapter.execute({ prompt: 'edit', cwd, sessionId, ephemeral: false }, () => {});
      expect(await readFile(join(cwd, '.cursor', 'worktrees', sessionId, 'HEAD'), 'utf8')).toBe('stay');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('unlinks a session symlink without deleting the target', async () => {
    const cwd = await tempWorkspace('gateway-cursor-link-');
    const outside = await tempWorkspace('gateway-cursor-outside-');
    try {
      await writeFile(join(outside, 'secret.txt'), 'keep');
      await mkdir(join(cwd, '.cursor', 'worktrees'), { recursive: true });
      await symlink(outside, join(cwd, '.cursor', 'worktrees', 'sess-link'));
      await cleanupCursorEphemeral(cwd, 'sess-link');
      expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('keep');
      await expect(stat(join(cwd, '.cursor', 'worktrees', 'sess-link'))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses session ids that could escape the workspace', async () => {
    const cwd = await tempWorkspace('gateway-cursor-unsafe-');
    try {
      await mkdir(join(cwd, '.cursor', 'worktrees', 'keep'), { recursive: true });
      await writeFile(join(cwd, '.cursor', 'worktrees', 'keep', 'HEAD'), 'stay');
      await cleanupCursorEphemeral(cwd, '..');
      await cleanupCursorEphemeral(cwd, '../keep');
      expect(await readFile(join(cwd, '.cursor', 'worktrees', 'keep', 'HEAD'), 'utf8')).toBe('stay');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
