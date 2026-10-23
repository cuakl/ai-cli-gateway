import type { UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { h, options, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { Transcript } from '../src/ui/chat/Transcript.js';
import type { TurnItem } from '../src/ui/chat/model.js';
import { WorkspaceError } from '../src/ui/workspace-client.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

describe('transcript rendering', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders streamed text, a tool row, then more text as two paragraphs', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Looking at the file.', segment: 0 }));
          emit(
            runEvent(message.requestId, 'tool_call', {
              toolName: 'Read',
              toolCallId: 'c1',
              toolArgs: { path: 'src/Hero.tsx' },
            }),
          );
          emit(runEvent(message.requestId, 'tool_result', { toolCallId: 'c1', toolOutput: 'export function Hero() {}' }));
          emit(runEvent(message.requestId, 'chunk', { text: 'The hero is a banner.', segment: 1 }));
          emit(
            runEvent(message.requestId, 'files_changed', {
              files: [{ path: 'src/Hero.tsx', additions: 4, deletions: 1 }],
            }),
          );
          emit(runEvent(message.requestId, 'done', { durationMs: 1200, model: 'gpt-5' }));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Edit the hero';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(shadow?.textContent).toContain('The hero is a banner.'));
    const assistant = shadow?.querySelector('.assistant-item');
    expect(assistant).toBeTruthy();
    const paragraphs = [...(assistant?.querySelectorAll('.markdown p') ?? [])];
    expect(paragraphs.map((node) => node.textContent)).toEqual([
      'Looking at the file.',
      'The hero is a banner.',
    ]);
    const blocks = [...(assistant?.querySelectorAll('.markdown, .tool-row') ?? [])];
    expect(blocks[0]?.classList.contains('markdown')).toBe(true);
    expect(blocks[1]?.classList.contains('tool-row')).toBe(true);
    expect(blocks[2]?.classList.contains('markdown')).toBe(true);
    expect(blocks[1]?.textContent).toContain('✓');
    expect(blocks[1]?.textContent).toContain('Read');
    expect(shadow?.querySelector('.messages')?.getAttribute('aria-live')).toBeNull();
  });

  it('marks a failed tool row with ✕', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(
            runEvent(message.requestId, 'tool_call', {
              toolName: 'Bash',
              toolCallId: 'sh1',
              toolArgs: { command: 'false' },
            }),
          );
          emit(
            runEvent(message.requestId, 'tool_result', {
              toolCallId: 'sh1',
              toolOutput: 'exit 1',
              isError: true,
            }),
          );
          emit(runEvent(message.requestId, 'done', { status: 'failed' }));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Run a command';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('.tool-row')?.textContent).toContain('✕'));
    expect(shadow?.querySelector('.tool-row')?.getAttribute('data-state')).toBe('error');
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="run-keep-going"]')).toBeTruthy());
    expect(shadow?.querySelector('[data-action="run-undo"]')).toBeNull();
  });

  it('sends git.checkpoint.restore from the run footer Undo button', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Edited the button.', segment: 0 }));
          emit(
            runEvent(message.requestId, 'files_changed', {
              files: [{ path: 'src/Hero.tsx', additions: 2, deletions: 1 }],
            }),
          );
          emit(runEvent(message.requestId, 'done', { durationMs: 400 }));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Tint the hero';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="run-undo"]')).toBeTruthy());
    (shadow?.querySelector('[data-action="run-undo"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        workspace.sent.some(
          (message) => message.type === 'git.checkpoint.restore' && message.runId === 'run_1' && !message.force,
        ),
      ).toBe(true),
    );
  });

  it('offers Force undo when restore reports conflict_newer_run', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type === 'git.checkpoint.restore') {
          if (!message.force) {
            throw new WorkspaceError('conflict_newer_run', 'A later run changed these files.');
          }
          return {
            type: 'git.checkpoint.restore.result',
            requestId: message.requestId,
            runId: message.runId,
            files: ['src/Hero.tsx'],
          };
        }
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Done.', segment: 0 }));
          emit(
            runEvent(message.requestId, 'files_changed', {
              files: [{ path: 'src/Hero.tsx', additions: 1, deletions: 0 }],
            }),
          );
          emit(runEvent(message.requestId, 'done', { durationMs: 10 }));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Tint the hero';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="run-undo"]')).toBeTruthy());
    (shadow?.querySelector('[data-action="run-undo"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="force-undo"]')).toBeTruthy());
    expect(shadow?.querySelector('.chat-notice-warning')?.textContent).toContain('later run');
    (shadow?.querySelector('[data-action="force-undo"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        workspace.sent.some(
          (message) => message.type === 'git.checkpoint.restore' && message.runId === 'run_1' && message.force === true,
        ),
      ).toBe(true),
    );
  });

  it('renders an error notice with setup steps and Retry resends the last prompt', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(
            runEvent(message.requestId, 'error', {
              error: 'Claude is not signed in.',
              code: 'cli_auth_required',
              setup: ['Run claude and finish sign-in.'],
            }),
          );
          emit(runEvent(message.requestId, 'done', { status: 'failed' }));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: `run_${workspace.sent.length}` };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Tint the hero';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="retry"]')).toBeTruthy());
    expect(shadow?.querySelector('.chat-notice-error')?.textContent).toContain('Claude is not signed in.');
    expect([... (shadow?.querySelectorAll('.chat-notice-setup li') ?? [])].map((item) => item.textContent)).toEqual([
      'Run claude and finish sign-in.',
    ]);
    (shadow?.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.filter((message) => message.type === 'run.start')).toHaveLength(2));
    const prompts = workspace.sent.filter((message) => message.type === 'run.start').map((message) => message.prompt);
    expect(prompts).toEqual(['Tint the hero', 'Tint the hero']);
  });

  it('shows Jump to latest when the transcript is scrolled up', () => {
    const items: TurnItem[] = [
      { kind: 'user', id: 'u1', text: 'Hello', chips: [] },
      {
        kind: 'assistant',
        id: 'a1',
        runId: 'run_1',
        status: 'done',
        blocks: [{ kind: 'markdown', text: 'Reply one.' }],
      },
      { kind: 'user', id: 'u2', text: 'Again', chips: [] },
      {
        kind: 'assistant',
        id: 'a2',
        runId: 'run_2',
        status: 'done',
        blocks: [{ kind: 'markdown', text: 'Reply two.' }],
      },
    ];
    const host = document.createElement('div');
    document.body.append(host);
    render(
      h(Transcript, {
        items,
        emptyTitle: 'Empty',
        emptyHint: 'Hint',
        onReview() {},
        onUndo() {},
        onKeepGoing() {},
        onNoticeAction() {},
      }),
      host,
    );

    const scroller = host.querySelector('.messages') as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(host.querySelector('[data-action="jump-latest"]')?.textContent).toBe('Jump to latest');
    expect(host.querySelector('.messages')?.getAttribute('aria-live')).toBeNull();
  });
});

function runEvent(
  requestId: string | undefined,
  type: UnifiedStreamEvent['type'],
  payload: Record<string, unknown> = {},
): WorkspaceServerMessage {
  return {
    type: 'run.event',
    requestId,
    runId: 'run_1',
    event: {
      id: `evt_${type}_${String(payload.segment ?? payload.toolCallId ?? 'n')}`,
      sessionId: 'sess_1',
      type,
      timestamp: 1,
      payload: payload as UnifiedStreamEvent['payload'],
    },
  };
}
