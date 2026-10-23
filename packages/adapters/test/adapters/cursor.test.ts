import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CursorLineParser, parseCursorLine } from '../../src/adapters/cursor.js';
import {
  cleanupCursorEphemeral,
  createAdapter,
  CursorAdapter,
  logger,
  ProcessManager,
  type ManagedProcessOptions,
} from '../../src/index.js';
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
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--workspace',
      '/work/demo',
      '--force',
      '--',
      'make it emerald',
    ]);
    expect(adapter.buildArgs({ ...base, prompt: '--help' })).toContain('--');
    expect(adapter.buildArgs({ ...base, yolo: true })).toContain('--force');
    expect(adapter.buildArgs({ ...base, yolo: false })).not.toContain('--force');
    expect(adapter.buildArgs({ ...base, yolo: false })).not.toContain('--yolo');
  });

  it('maps JSON events and aggregate payloads, and logs non-JSON stdout', () => {
    const debug = vi.spyOn(logger, 'debug');
    try {
      const noise = "cursor-retrieval: tracing to '/var/folders/xx/cursor_retrieval.log'";
      expect(parseCursorLine(noise, 'sess')).toEqual([]);
      expect(parseCursorLine('{not-json', 'sess')).toEqual([]);
      expect(parseCursorLine('cursor status', 'sess')).toEqual([]);
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('cursor-retrieval'));
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('{not-json'));
    } finally {
      debug.mockRestore();
    }

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

    expect(parseCursorLine(JSON.stringify({ type: 'system', subtype: 'init' }), 'sess')).toEqual([]);
    expect(parseCursorLine(JSON.stringify({ type: 'thinking', subtype: 'delta', text: 'hidden' }), 'sess')).toEqual(
      [],
    );
    expect(parseCursorLine(JSON.stringify({ type: 'user', message: { content: [{ text: 'hi' }] } }), 'sess')).toEqual(
      [],
    );
    const streamed = parseCursorLine(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Tinting it.' }] },
      }),
      'sess',
    );
    expect(streamed[0]).toMatchObject({ type: 'chunk', payload: { text: 'Tinting it.' } });
    const edit = parseCursorLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-hero',
        tool_call: { tool: { case: 'editToolCall', value: { args: { path: 'src/components/Hero.tsx' } } } },
      }),
      'sess',
    );
    expect(edit.map((event) => event.type)).toEqual(['tool_call', 'file_edit']);
    expect(edit[0]?.payload.toolCallId).toBe('call-hero');
    expect(edit[1]?.payload.filePath).toBe('src/components/Hero.tsx');
    const finished = parseCursorLine(
      JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 120, result: 'Tinting it.' }),
      'sess',
    );
    expect(finished.map((event) => event.type)).toEqual(['done']);
    expect(finished[0]?.payload.durationMs).toBe(120);
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
      expect(result.summary).toBe('Updated hero button');
      expect(result.summary).not.toContain('cursor-retrieval');
      expect(events.some((event) => JSON.stringify(event.payload).includes('cursor-retrieval'))).toBe(false);
      expect(events.map((event) => event.type)).toEqual([
        'init',
        'chunk',
        'tool_call',
        'file_edit',
        'tool_call',
        'file_edit',
        'done',
      ]);
      expect(events.filter((event) => event.type === 'chunk').map((event) => event.payload.segment)).toEqual([0]);
      expect(events.filter((event) => event.type === 'tool_call').map((event) => event.payload.toolCallId)).toEqual([
        'call-hero',
        'call-app',
      ]);
      expect(events.filter((event) => event.type === 'file_edit').map((event) => event.payload.filePath)).toEqual([
        'src/components/Hero.tsx',
        'src/App.tsx',
      ]);
      expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
      expect(events.at(-1)?.payload).toEqual({ durationMs: 120 });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('shows a streamed assistant reply once when Cursor repeats the final message', () => {
    const parser = new CursorLineParser();
    const partial = JSON.stringify({
      type: 'assistant',
      timestamp_ms: 1,
      message: { content: [{ type: 'text', text: "I'll update the label." }] },
    });
    const again = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: "I'll update the label." }] },
    });
    const done = JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 5, result: "I'll update the label." });
    expect(parser.parse(partial, 's').map((event) => event.payload.text)).toEqual(["I'll update the label."]);
    expect(parser.parse(again, 's')).toEqual([]);
    expect(parser.parse(done, 's').map((event) => event.type)).toEqual(['done']);
  });

  it('keeps assistant text when the CLI sends only the final message', () => {
    const parser = new CursorLineParser();
    const final = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Updated hero button' }] },
    });
    expect(parser.parse(final, 's')[0]?.payload.text).toBe('Updated hero button');
  });

  it('passes an IDE access token only through the child environment', async () => {
    const cwd = await tempWorkspace('gateway-cursor-auth-env-');
    const token = 'cursor-test-token-value-0123456789';
    const seen: Array<NodeJS.ProcessEnv | undefined> = [];
    class RecordingManager extends ProcessManager {
      override start(options: ManagedProcessOptions): Promise<number> {
        seen.push(options.env);
        return super.start(options);
      }
    }
    try {
      const adapter = new CursorAdapter(
        resolverFor('cursor', fixture('mock-cursor.js')),
        new RecordingManager(),
        async () => token,
      );
      const result = await adapter.execute({ prompt: 'update the hero', cwd, sessionId: 'sess-auth' }, () => {});
      expect(result.exitCode).toBe(0);
      expect(seen).toEqual([{ CURSOR_AUTH_TOKEN: token }]);
      expect(JSON.stringify(adapter.buildArgs({ prompt: 'update the hero', cwd }))).not.toContain(token);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not replace an explicit Cursor API key', async () => {
    const cwd = await tempWorkspace('gateway-cursor-auth-explicit-');
    const previous = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = 'explicit-cursor-key';
    const seen: Array<NodeJS.ProcessEnv | undefined> = [];
    class RecordingManager extends ProcessManager {
      override start(options: ManagedProcessOptions): Promise<number> {
        seen.push(options.env);
        return super.start(options);
      }
    }
    try {
      const adapter = new CursorAdapter(
        resolverFor('cursor', fixture('mock-cursor.js')),
        new RecordingManager(),
        async () => 'cursor-test-token-value-0123456789',
      );
      await adapter.execute({ prompt: 'update the hero', cwd, sessionId: 'sess-explicit' }, () => {});
      expect(seen).toEqual([undefined]);
    } finally {
      if (previous === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = previous;
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
