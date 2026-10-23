import type { GitDiffSummary, UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { createFakeWorkspace, type FakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(): void {}
    open(): void {}
    onData(): { dispose(): void } {
      return { dispose() {} };
    }
    onResize(): { dispose(): void } {
      return { dispose() {} };
    }
    write(): void {}
    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}));

const summary: GitDiffSummary = {
  branch: 'main',
  insertions: 1,
  deletions: 0,
  files: [
    {
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, content: ' line\n+next' }],
    },
  ],
};

describe('overlay tabs', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    vi.clearAllMocks();
  });

  it('switches between chat, diffs, terminal, and tests', async () => {
    const workspace = createFakeWorkspace({ summary });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="diffs"]')?.getAttribute('data-count')).toBe('1'));
    expect(shadow?.querySelector('[data-action="diffs"]')?.textContent).toContain('1');

    (shadow?.querySelector('[data-action="diffs"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeTruthy();
    expect(shadow?.textContent).toContain('src/App.tsx');

    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    const terminal = shadow?.querySelector('section[aria-label="Terminal"]') as HTMLElement;
    expect(terminal).toBeTruthy();
    expect(terminal.hidden).toBe(false);
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeTruthy();
    await vi.waitFor(() => expect(sentTypes(workspace, 'pty.spawn')).toBe(1));

    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Tests"]')).toBeTruthy();
    expect(shadow?.querySelector('[aria-label="Tests"] .kicker')?.textContent).toBe('Tests');
    expect(terminal.hidden).toBe(true);
    expect(sentTypes(workspace, 'pty.dispose')).toBe(0);
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-status="passed"]')).toBeTruthy());
    expect(shadow?.textContent).toContain('1 passed');

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('textarea')).toBeTruthy();
    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    expect(terminal.hidden).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentTypes(workspace, 'pty.spawn')).toBe(1);
    expect(sentTypes(workspace, 'pty.dispose')).toBe(0);
    (shadow?.querySelector('[data-action="close-terminal"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('section[aria-label="Terminal"]')).toBeNull();
    await vi.waitFor(() =>
      expect(workspace.sent.some((message) => message.type === 'pty.dispose' && message.sessionId === 'pty_test')).toBe(
        true,
      ),
    );

    expect(shadow?.querySelector('textarea')).toBeTruthy();
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('textarea')).toBeNull();
  });

  it('shows the package name and stops a running suite', async () => {
    let emitFinished: ((message: WorkspaceServerMessage) => void) | undefined;
    const workspace = createFakeWorkspace({
      summary,
      onSend(message, emit) {
        if (message.type === 'test.run') emitFinished = emit;
        if (message.type === 'test.stop') {
          emitFinished?.({
            type: 'test.finished',
            status: 'cancelled',
            summary: { passed: 0, failed: 0, skipped: 0, durationMs: 1 },
          });
        }
      },
    });
    const host = initDevtools({ workspace, projectName: 'demo-react-app' });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Tests"] .kicker')?.textContent).toBe('demo-react-app');
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="stop-tests"]')).toBeTruthy());
    (shadow?.querySelector('[data-action="stop-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-status="stopped"]')).toBeTruthy());
    expect(workspace.sent.some((message) => message.type === 'test.stop')).toBe(true);
    expect(shadow?.textContent).toContain('Stopped.');
  });

  it('asks for a diff review after the agent edits a file', async () => {
    const workspace = createFakeWorkspace({
      summary,
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'file_edit', { filePath: 'src/App.tsx' }));
          emit(runEvent(message.requestId, 'chunk', { text: 'Updated the button', segment: 0 }));
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Edited 1 file'));
    const start = workspace.sent.find((message) => message.type === 'run.start');
    expect(start).toMatchObject({
      type: 'run.start',
      mode: 'agent',
      provider: 'cursor',
      prompt: 'Make it emerald',
      attachments: [],
    });
    expect(start?.prompt).not.toContain('<frontend_context>');
    (shadow?.querySelector('[data-action="review-diffs"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeTruthy();
    expect(shadow?.textContent).not.toContain('Edited 1 file');
  });

  it('updates the diff badge when the workspace pushes git.changed', async () => {
    const workspace = createFakeWorkspace({ summary: { files: [], insertions: 0, deletions: 0 } });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'git.diff')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    workspace.emit({ type: 'git.changed', summary });
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="diffs"]')?.getAttribute('data-count')).toBe('1'));
  });
});

function sentTypes(workspace: FakeWorkspace, type: string): number {
  return workspace.sent.filter((message) => message.type === type).length;
}

function runEvent(
  requestId: string | undefined,
  type: UnifiedStreamEvent['type'],
  payload: UnifiedStreamEvent['payload'] = {},
): WorkspaceServerMessage {
  return {
    type: 'run.event',
    requestId,
    runId: 'run_1',
    event: {
      id: `evt_${type}`,
      sessionId: 'sess_1',
      type,
      timestamp: 1,
      payload,
    },
  };
}
