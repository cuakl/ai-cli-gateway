import { rm } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseAntigravityLine, AntigravityAdapter } from '../../src/adapters/antigravity.js';
import { createAdapter, ProcessManager } from '../../src/index.js';
import { collectEvents, ensureFixtures, fixture, resolverFor, tempWorkspace } from './helpers.js';

const prompt = 'hello; echo injected && rm -rf /';

describe('AntigravityAdapter', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('builds headless args, session continuity, and file context', () => {
    const adapter = new AntigravityAdapter();
    expect(adapter.provider).toBe('antigravity');
    expect(adapter.buildArgs({ prompt: 'tint the button', cwd: '/repo' })).toEqual([
      '--print',
      'tint the button',
      '--output-format',
      'stream-json',
      '--workspace',
      '/repo',
    ]);
    expect(
      adapter.buildArgs({
        prompt: 'tint the button',
        cwd: '/repo',
        sessionId: 'sess-9',
        files: ['src/Hero.tsx', 'src/App.tsx'],
      }),
    ).toEqual([
      '--print',
      'tint the button',
      '--output-format',
      'stream-json',
      '--workspace',
      '/repo',
      '--conversation',
      'sess-9',
      '--file',
      'src/Hero.tsx',
      '--file',
      'src/App.tsx',
    ]);
  });

  it('maps NDJSON events and falls back to chunks for plain text', () => {
    expect(parseAntigravityLine('status: writing styles', 'sess-1')).toMatchObject([
      { sessionId: 'sess-1', type: 'chunk', payload: { text: 'status: writing styles' } },
    ]);
    expect(parseAntigravityLine('{not-json', 'sess-1')[0]).toMatchObject({
      type: 'chunk',
      payload: { text: '{not-json' },
    });

    const tool = parseAntigravityLine(
      JSON.stringify({ type: 'tool_call', toolName: 'Edit', toolArgs: { file: 'src/A.tsx' } }),
      'sess-1',
    );
    expect(tool.map((event) => event.type)).toEqual(['tool_call', 'file_edit']);
    expect(tool[0]?.payload).toMatchObject({ toolName: 'Edit', toolArgs: { file: 'src/A.tsx' } });
    expect(tool[1]?.payload.filePath).toBe('src/A.tsx');

    const done = parseAntigravityLine(
      JSON.stringify({ type: 'result', durationMs: 42, costUsd: 0.01, text: 'button updated' }),
      'sess-1',
    );
    expect(done).toMatchObject([
      { type: 'done', payload: { durationMs: 42, costUsd: 0.01, text: 'button updated' } },
    ]);
  });

  it('streams mock agy NDJSON in order, including a non-JSON line', async () => {
    const cwd = await tempWorkspace('gateway-agy-');
    try {
      const adapter = createAdapter('antigravity', {
        binaries: resolverFor('antigravity', fixture('mock-agy.js')),
        processes: new ProcessManager(),
      });
      const { events, onEvent } = collectEvents();
      const result = await adapter.execute({ prompt, cwd, sessionId: 'sess-agy' }, onEvent);

      expect(result.exitCode).toBe(0);
      expect(events.map((event) => event.type)).toEqual([
        'init',
        'chunk',
        'init',
        'chunk',
        'chunk',
        'chunk',
        'tool_call',
        'tool_result',
        'file_edit',
        'done',
        'done',
      ]);
      expect(events.every((event) => event.sessionId === 'sess-agy')).toBe(true);
      const chunks = events.filter((event) => event.type === 'chunk').map((event) => event.payload.text);
      expect(chunks).toEqual([prompt, 'Hello ', 'world', 'status: writing styles']);
      expect(result.summary).toBe(chunks.join(''));
      expect(events[0]?.payload.text).toBe('antigravity session started');
      expect(events[2]?.payload.text).toBe('agy session ready');
      expect(events.find((event) => event.type === 'tool_call')?.payload).toMatchObject({
        toolName: 'Edit',
        toolArgs: { old_string: 'blue', new_string: 'emerald' },
      });
      expect(events.find((event) => event.type === 'tool_result')?.payload.toolOutput).toBe('edited Hero.tsx');
      expect(events.find((event) => event.type === 'file_edit')?.payload.filePath).toBe('src/Hero.tsx');
      expect(events.find((event) => event.type === 'done' && event.payload.costUsd === 0.01)?.payload).toMatchObject({
        durationMs: 42,
        costUsd: 0.01,
        text: 'button updated',
      });
      expect(events.at(-1)?.type).toBe('done');
      expect(events.at(-1)?.payload.costUsd).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
