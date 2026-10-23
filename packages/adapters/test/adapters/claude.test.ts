import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseClaudeLine, ClaudeAdapter, ClaudeLineParser, DEFAULT_CLAUDE_TOOLS } from '../../src/adapters/claude.js';
import { createAdapter, ProcessManager } from '../../src/index.js';
import { collectEvents, ensureFixtures, fixture, resolverFor, tempWorkspace } from './helpers.js';

const execFileAsync = promisify(execFile);

describe('ClaudeAdapter', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('builds headless args and joins allowed tools', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.provider).toBe('claude');
    expect(adapter.buildArgs({ prompt: 'fix the layout', cwd: '/repo' })).toEqual([
      '-p',
      'fix the layout',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      DEFAULT_CLAUDE_TOOLS.join(','),
    ]);
    expect(adapter.buildArgs({ prompt: 'fix', cwd: '/repo', allowedTools: ['Read', 'Edit'] })).toContain('Read,Edit');
    const args = adapter.buildArgs({ prompt: 'fix the layout', cwd: '/repo' });
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--permission-prompts');
  });

  it('rejects unknown flags the way claude does', async () => {
    await expect(
      execFileAsync(process.execPath, [fixture('mock-claude.js'), '--permission-prompts', 'none'], {
        encoding: 'utf8',
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: "error: unknown option '--permission-prompts'\n",
    });
  });

  it('maps Anthropic stream events and ignores non-JSON stdout', () => {
    expect(parseClaudeLine('still thinking', 'sess')).toEqual([]);
    expect(parseClaudeLine('{not-json', 'sess')).toEqual([]);

    const delta = parseClaudeLine(JSON.stringify({ type: 'text_delta', text: 'Hello' }), 'sess');
    expect(delta).toMatchObject([{ type: 'chunk', payload: { text: 'Hello' } }]);

    const assistant = parseClaudeLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hi' },
            { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'src/A.tsx' } },
          ],
        },
      }),
      'sess',
    );
    expect(assistant.map((event) => event.type)).toEqual(['chunk', 'tool_call', 'file_edit']);
    expect(assistant[1]?.payload).toMatchObject({
      toolName: 'Edit',
      toolCallId: 'toolu_1',
      toolArgs: { file_path: 'src/A.tsx' },
    });

    expect(parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init' }), 'sess')).toEqual([]);
    expect(
      parseClaudeLine(
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }),
        'sess',
      ),
    ).toEqual([]);

    const done = parseClaudeLine(
      JSON.stringify({ type: 'result', result: 'Updated styles', duration_ms: 80, total_cost_usd: 0.02 }),
      'sess',
    );
    expect(done).toMatchObject([
      { type: 'done', payload: { text: 'Updated styles', durationMs: 80, costUsd: 0.02 } },
    ]);

    const parser = new ClaudeLineParser();
    const streamed = [
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Edit', input: {} },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'OK' },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/A.tsx' } },
          ],
        },
      }),
    ].flatMap((line) => parser.parse(line, 'sess'));
    expect(streamed.map((event) => event.type)).toEqual(['chunk', 'tool_call', 'file_edit']);
    expect(streamed[0]?.payload).toMatchObject({ text: 'OK' });
    expect(streamed[1]?.payload).toMatchObject({ toolArgs: { file_path: 'src/A.tsx' } });
  });

  it('streams mock claude events in order', async () => {
    const cwd = await tempWorkspace('gateway-claude-');
    try {
      const adapter = createAdapter('claude', {
        binaries: resolverFor('claude', fixture('mock-claude.js')),
        processes: new ProcessManager(),
      });
      const { events, onEvent } = collectEvents();
      const result = await adapter.execute({ prompt: 'fix the button', cwd, sessionId: 'sess-claude' }, onEvent);

      expect(result.exitCode).toBe(0);
      expect(result.summary).toBe('Looking at the button');
      expect(events.map((event) => event.type)).toEqual([
        'init',
        'chunk',
        'chunk',
        'tool_call',
        'file_edit',
        'tool_result',
        'done',
      ]);
      expect(events.every((event) => event.sessionId === 'sess-claude')).toBe(true);
      expect(events.filter((event) => event.type === 'chunk').map((event) => event.payload.segment)).toEqual([0, 0]);
      expect(events.find((event) => event.type === 'tool_call')?.payload.toolName).toBe('Edit');
      expect(events.find((event) => event.type === 'tool_call')?.payload.toolCallId).toBe('toolu_edit');
      expect(events.find((event) => event.type === 'file_edit')?.payload.filePath).toBe('src/App.tsx');
      expect(events.find((event) => event.type === 'tool_result')?.payload.toolOutput).toBe('updated App.tsx');
      expect(events.find((event) => event.type === 'tool_result')?.payload.toolCallId).toBe('toolu_edit');
      expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
      expect(events.at(-1)?.payload).toMatchObject({
        durationMs: 80,
        costUsd: 0.02,
        text: 'Updated styles',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
