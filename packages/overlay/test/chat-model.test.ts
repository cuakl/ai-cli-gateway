import type { Run, StreamEventPayload, UnifiedStreamEvent } from '@aidev/protocol';
import { describe, expect, it } from 'vitest';
import {
  RESULT_LIMIT,
  applyEvent,
  emptyChatState,
  groupToolBlocks,
  hydrateFromThread,
  startTurn,
  toolLabel,
  type AssistantItem,
  type ChatState,
  type ContextChip,
  type NoticeItem,
  type ToolBlock,
} from '../src/ui/chat/model.js';

const RUN = 'run_abc';
const OTHER = 'run_other';
const CHIPS: ContextChip[] = [{ id: 'chip-1', kind: 'selection', label: 'Hero · Hero.tsx:11' }];

describe('startTurn', () => {
  it('appends a user item and an empty running assistant', () => {
    const state = startTurn(emptyChatState(), { userText: 'Make it green', chips: CHIPS, runId: RUN });
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'Make it green', chips: CHIPS });
    expect(state.items[1]).toMatchObject({
      kind: 'assistant',
      runId: RUN,
      blocks: [],
      status: 'running',
    });
  });

  it('does not mutate the previous state', () => {
    const initial = emptyChatState();
    const next = startTurn(initial, { userText: 'Hi', chips: [], runId: RUN });
    expect(initial.items).toHaveLength(0);
    expect(next.items).not.toBe(initial.items);
  });
});

describe('applyEvent', () => {
  it('ignores events for an unknown runId', () => {
    const state = begin();
    const next = applyEvent(state, OTHER, evt('chunk', { text: 'secret', segment: 0 }));
    expect(next).toBe(state);
  });

  it('handles init, session_info, checkpoint, and file_edit', () => {
    let state = begin();
    const afterInit = applyEvent(state, RUN, evt('init', {}));
    expect(afterInit).toBe(state);

    state = applyEvent(state, RUN, evt('session_info', { providerSessionId: 'chat_1', model: 'sonnet' }));
    state = applyEvent(state, RUN, evt('checkpoint', { ref: 'refs/aidev/checkpoints/run_abc' }));
    const afterEdit = applyEvent(state, RUN, evt('file_edit', { filePath: 'src/Hero.tsx' }));
    expect(afterEdit).toBe(state);
    expect(assistantOf(state)).toMatchObject({
      model: 'sonnet',
      providerSessionId: 'chat_1',
      checkpointRef: 'refs/aidev/checkpoints/run_abc',
      blocks: [],
    });
  });

  it('turns a segment -1 chunk into an info notice', () => {
    const state = applyEvent(
      begin(),
      RUN,
      evt('chunk', { text: '3 files already modified.', segment: -1 }),
    );
    const notice = state.items.find((item): item is NoticeItem => item.kind === 'notice');
    expect(notice).toMatchObject({ kind: 'notice', tone: 'info', text: '3 files already modified.' });
    expect(assistantOf(state).blocks).toEqual([]);
  });

  it('appends chunk text to the markdown block for the same segment', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('chunk', { text: 'Hello', segment: 0 }));
    state = applyEvent(state, RUN, evt('chunk', { text: ' world', segment: 0 }));
    expect(assistantOf(state).blocks).toEqual([{ kind: 'markdown', text: 'Hello world' }]);
  });

  it('splits pre-tool and post-tool text into separate markdown blocks', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('chunk', { text: 'Looking at `Hero.tsx`.', segment: 0 }));
    state = applyEvent(
      state,
      RUN,
      evt('tool_call', { toolName: 'Read', toolCallId: 'c1', toolArgs: { file_path: 'src/Hero.tsx' } }),
    );
    state = applyEvent(state, RUN, evt('tool_result', { toolCallId: 'c1', toolOutput: 'export function Hero() {}' }));
    state = applyEvent(state, RUN, evt('chunk', { text: 'The hero is a banner.', segment: 1 }));
    expect(assistantOf(state).blocks.map((block) => block.kind)).toEqual(['markdown', 'tool', 'markdown']);
    expect(assistantOf(state).blocks[0]).toEqual({ kind: 'markdown', text: 'Looking at `Hero.tsx`.' });
    expect(assistantOf(state).blocks[2]).toEqual({ kind: 'markdown', text: 'The hero is a banner.' });
    expect(assistantOf(state).blocks[1]).toMatchObject({
      kind: 'tool',
      toolCallId: 'c1',
      name: 'Read',
      label: 'Read `src/Hero.tsx`',
      target: 'src/Hero.tsx',
      state: 'ok',
      result: 'export function Hero() {}',
    });
  });

  it('records tool_call labels from payload.toolName, toolCallId, and toolArgs', () => {
    const state = applyEvent(
      begin(),
      RUN,
      evt('tool_call', {
        toolName: 'StrReplace',
        toolCallId: 'edit_1',
        toolArgs: { path: 'src/App.tsx' },
      }),
    );
    expect(assistantOf(state).blocks[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'edit_1',
      name: 'StrReplace',
      label: 'Edited `src/App.tsx`',
      state: 'running',
      args: { path: 'src/App.tsx' },
    });
  });

  it('marks tool_result as error and truncates payload.toolOutput', () => {
    const long = 'x'.repeat(RESULT_LIMIT + 25);
    let state = begin();
    state = applyEvent(state, RUN, evt('tool_call', { toolName: 'Bash', toolCallId: 'sh1', toolArgs: { command: 'ls' } }));
    state = applyEvent(
      state,
      RUN,
      evt('tool_result', { toolCallId: 'sh1', toolOutput: long, isError: true }),
    );
    const block = assistantOf(state).blocks[0] as ToolBlock;
    expect(block.state).toBe('error');
    expect(block.result).toHaveLength(RESULT_LIMIT);
    expect(block.label).toBe('Ran `ls`');
  });

  it('ignores unmatched tool_result events', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('tool_call', { toolName: 'Read', toolCallId: 'c1' }));
    const next = applyEvent(state, RUN, evt('tool_result', { toolCallId: 'missing', toolOutput: 'nope' }));
    expect(next).toBe(state);
    expect(assistantOf(state).blocks[0]).toMatchObject({ state: 'running' });
    expect('result' in (assistantOf(state).blocks[0] ?? {})).toBe(false);
  });

  it('stores files_changed as a files block using path, additions, and deletions', () => {
    const state = applyEvent(
      begin(),
      RUN,
      evt('files_changed', {
        files: [
          { path: 'src/Hero.tsx', additions: 12, deletions: 3 },
          { path: 'src/App.tsx', additions: 1, deletions: 0 },
        ],
      }),
    );
    expect(assistantOf(state).blocks[0]).toEqual({
      kind: 'files',
      files: [
        { path: 'src/Hero.tsx', additions: 12, deletions: 3 },
        { path: 'src/App.tsx', additions: 1, deletions: 0 },
      ],
    });
  });

  it('maps string files_changed paths from the protocol payload', () => {
    const state = applyEvent(begin(), RUN, evt('files_changed', { files: ['src/Hero.tsx'] }));
    expect(assistantOf(state).blocks[0]).toEqual({
      kind: 'files',
      files: [{ path: 'src/Hero.tsx', additions: 0, deletions: 0 }],
    });
  });

  it('turns an error into assistant status error plus a setup notice', () => {
    const state = applyEvent(
      begin(),
      RUN,
      evt('error', {
        error: 'Claude is not signed in.',
        code: 'cli_auth_required',
        setup: ['Run claude and finish sign-in.'],
      }),
    );
    expect(assistantOf(state).status).toBe('error');
    const notice = state.items.find((item): item is NoticeItem => item.kind === 'notice');
    expect(notice).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: 'Claude is not signed in.',
      setup: ['Run claude and finish sign-in.'],
    });
    expect(notice?.actions).toEqual([
      { label: 'Retry', action: 'retry' },
      { label: 'Copy command', action: 'copy-command' },
    ]);
  });

  it('finalizes done with payload status and durationMs', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('tool_call', { toolName: 'Read', toolCallId: 'c1' }));
    state = applyEvent(state, RUN, evt('done', { status: 'succeeded', durationMs: 1500 }));
    const item = assistantOf(state);
    expect(item.status).toBe('succeeded');
    expect(item.durationMs).toBe(1500);
    expect(item.blocks[0]).toMatchObject({ state: 'ok' });
  });

  it('defaults done status to done and marks leftover tools ok', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('tool_call', { toolName: 'Grep', toolCallId: 'g1', toolArgs: { pattern: 'Hero' } }));
    state = applyEvent(state, RUN, evt('done', { durationMs: 40 }));
    expect(assistantOf(state)).toMatchObject({ status: 'done', durationMs: 40 });
    expect(assistantOf(state).blocks[0]).toMatchObject({
      label: 'Searched `Hero`',
      state: 'ok',
    });
  });

  it('marks leftover running tools as error when the run errored', () => {
    let state = begin();
    state = applyEvent(state, RUN, evt('tool_call', { toolName: 'Read', toolCallId: 'c1' }));
    state = applyEvent(state, RUN, evt('error', { error: 'boom' }));
    state = applyEvent(state, RUN, evt('done', { durationMs: 9 }));
    expect(assistantOf(state).status).toBe('error');
    expect(assistantOf(state).blocks[0]).toMatchObject({ state: 'error' });
  });

  it('walks a full stream without mutating prior snapshots', () => {
    const started = begin();
    const events: UnifiedStreamEvent[] = [
      evt('init', {}),
      evt('session_info', { providerSessionId: 'chat_9', model: 'gpt-5' }),
      evt('checkpoint', { ref: 'refs/aidev/checkpoints/run_abc' }),
      evt('chunk', { text: 'Working tree is dirty.', segment: -1 }),
      evt('chunk', { text: 'Pre ', segment: 0 }),
      evt('chunk', { text: 'tool.', segment: 0 }),
      evt('tool_call', { toolName: 'Write', toolCallId: 'w1', toolArgs: { path: 'src/New.tsx' } }),
      evt('file_edit', { filePath: 'src/New.tsx' }),
      evt('tool_result', { toolCallId: 'w1', toolOutput: 'wrote file' }),
      evt('chunk', { text: 'Post tool.', segment: 1 }),
      evt('files_changed', { files: [{ path: 'src/New.tsx', additions: 4, deletions: 0 }] }),
      evt('done', { durationMs: 80 }),
    ];
    let state = started;
    for (const event of events) state = applyEvent(state, RUN, event);
    expect(started.items[1]).toMatchObject({ kind: 'assistant', blocks: [], status: 'running' });
    expect(assistantOf(state).blocks.map((block) => block.kind)).toEqual([
      'markdown',
      'tool',
      'markdown',
      'files',
    ]);
    expect(assistantOf(state).status).toBe('done');
    expect(state.items.some((item) => item.kind === 'notice')).toBe(true);
  });
});

describe('toolLabel', () => {
  it('uses a verb and backticked target', () => {
    expect(toolLabel('Edit', { file: 'Hero.tsx' })).toBe('Edited `Hero.tsx`');
    expect(toolLabel('Write', { path: 'a.ts' })).toBe('Edited `a.ts`');
    expect(toolLabel('Read', { file_path: 'b.ts' })).toBe('Read `b.ts`');
    expect(toolLabel('Bash', { cmd: 'pnpm test' })).toBe('Ran `pnpm test`');
    expect(toolLabel('shell', { command: 'ls' })).toBe('Ran `ls`');
    expect(toolLabel('Grep', { q: 'TODO' })).toBe('Searched `TODO`');
    expect(toolLabel('Glob', { glob: '**/*.ts' })).toBe('Searched `**/*.ts`');
    expect(toolLabel('Think')).toBe('Think');
  });
});

describe('groupToolBlocks', () => {
  it('collapses consecutive successful reads into Read N files', () => {
    const blocks = [
      { kind: 'markdown', text: 'hi' },
      readBlock('r1', 'a.ts'),
      readBlock('r2', 'b.ts'),
      readBlock('r3', 'c.ts'),
      {
        kind: 'tool',
        toolCallId: 'e1',
        name: 'Edit',
        label: 'Edited `a.ts`',
        state: 'ok' as const,
      },
      readBlock('r4', 'd.ts'),
    ] as const;
    const grouped = groupToolBlocks(blocks);
    expect(grouped[0]).toEqual({ kind: 'block', block: blocks[0] });
    expect(grouped[1]).toMatchObject({ kind: 'read-group', count: 3, label: 'Read 3 files' });
    expect(grouped[2]).toEqual({ kind: 'block', block: blocks[4] });
    expect(grouped[3]).toEqual({ kind: 'block', block: blocks[5] });
  });
});

describe('hydrateFromThread', () => {
  it('replays stored runs through the reducer', () => {
    const run: Run = {
      id: RUN,
      threadId: 'thr_1',
      prompt: 'Make it green',
      contextSummary: {
        selections: [{ tagName: 'BUTTON', componentName: 'Hero', fileName: 'Hero.tsx', lineNumber: 11 }],
        errorCount: 0,
        logCount: 0,
        failedRequestCount: 0,
        screenshotAttached: false,
      },
      attachments: [],
      status: 'succeeded',
      startedAt: 1,
      endedAt: 2,
      checkpoint: null,
      filesTouched: ['Hero.tsx'],
      error: null,
      usage: { durationMs: 12 },
    };
    const state = hydrateFromThread(run ? [run] : [], [
      { runId: RUN, event: evt('chunk', { text: 'Done.', segment: 0 }) },
      { runId: RUN, event: evt('done', {}) },
    ]);
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'Make it green' });
    expect(assistantOf(state).blocks).toEqual([{ kind: 'markdown', text: 'Done.' }]);
    expect(assistantOf(state).status).toBe('done');
  });
});

function begin(): ChatState {
  return startTurn(emptyChatState(), { userText: 'Hi', chips: CHIPS, runId: RUN });
}

function assistantOf(state: ChatState): AssistantItem {
  const item = [...state.items].reverse().find((entry): entry is AssistantItem => entry.kind === 'assistant');
  if (!item) throw new Error('missing assistant');
  return item;
}

function readBlock(toolCallId: string, path: string): ToolBlock {
  return {
    kind: 'tool',
    toolCallId,
    name: 'Read',
    label: `Read \`${path}\``,
    target: path,
    state: 'ok',
  };
}

let seq = 0;

function evt(type: UnifiedStreamEvent['type'], payload: Record<string, unknown>): UnifiedStreamEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    sessionId: 'sess_1',
    type,
    timestamp: seq,
    payload: payload as StreamEventPayload,
  };
}
