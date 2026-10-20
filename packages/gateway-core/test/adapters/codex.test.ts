import { rm } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCodexLine, CodexAdapter } from '../../src/adapters/codex.js';
import { createAdapter, ProcessManager } from '../../src/index.js';
import { collectEvents, ensureFixtures, fixture, resolverFor, tempWorkspace } from './helpers.js';

describe('CodexAdapter', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('builds exec args and inserts resume before the prompt', () => {
    const adapter = new CodexAdapter();
    expect(adapter.provider).toBe('codex');
    expect(adapter.buildArgs({ prompt: 'rename the header', cwd: '/repo' })).toEqual([
      'exec',
      '--jsonl',
      '--sandbox',
      'workspace-write',
      'rename the header',
    ]);
    expect(adapter.buildArgs({ prompt: 'rename the header', cwd: '/repo', sessionId: 'sess-9' })).toEqual([
      'exec',
      'resume',
      'sess-9',
      '--jsonl',
      '--sandbox',
      'workspace-write',
      'rename the header',
    ]);
  });

  it('maps JSONL events and plain text', () => {
    expect(parseCodexLine('working', 'sess')[0]).toMatchObject({
      type: 'chunk',
      payload: { text: 'working' },
    });
    expect(parseCodexLine('{not-json', 'sess')[0]?.type).toBe('chunk');

    const call = parseCodexLine(
      JSON.stringify({ type: 'tool_call', toolName: 'shell', toolArgs: { cmd: 'ls' } }),
      'sess',
    );
    expect(call).toMatchObject([{ type: 'tool_call', payload: { toolName: 'shell', toolArgs: { cmd: 'ls' } } }]);

    const item = parseCodexLine(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Renamed the header' } }),
      'sess',
    );
    expect(item).toMatchObject([{ type: 'chunk', payload: { text: 'Renamed the header' } }]);
  });

  it('streams mock codex JSONL in order', async () => {
    const cwd = await tempWorkspace('gateway-codex-');
    try {
      const adapter = createAdapter('codex', {
        binaries: resolverFor('codex', fixture('mock-codex.js')),
        processes: new ProcessManager(),
      });
      const { events, onEvent } = collectEvents();
      const result = await adapter.execute(
        { prompt: 'rename the header', cwd, sessionId: 'sess-codex' },
        onEvent,
      );

      expect(result.exitCode).toBe(0);
      expect(result.summary).toBe('Renamed the header');
      expect(events.map((event) => event.type)).toEqual([
        'init',
        'chunk',
        'tool_call',
        'tool_result',
        'file_edit',
        'done',
        'done',
      ]);
      expect(events.every((event) => event.sessionId === 'sess-codex')).toBe(true);
      expect(events.find((event) => event.type === 'tool_call')?.payload).toMatchObject({
        toolName: 'command_execution',
        toolArgs: { command: 'ls src' },
      });
      expect(events.find((event) => event.type === 'tool_result')?.payload.toolOutput).toBe('App.tsx');
      expect(events.find((event) => event.type === 'file_edit')?.payload.filePath).toBe('src/Header.tsx');
      expect(events.find((event) => event.type === 'done' && event.payload.costUsd === 0.004)?.payload).toMatchObject({
        durationMs: 55,
        costUsd: 0.004,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
