import type { GitDiffSummary, UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { h, options, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { ToastStack } from '../src/ui/ToastStack.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

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

describe('ToastStack', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders role=status and runs action and dismiss', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    render(
      h(ToastStack, {
        toasts: [
          {
            id: 'toast-1',
            text: 'Edited 1 file',
            actions: [{ label: 'Review', action: 'review-diffs', onClick: onAction }],
          },
        ],
        corner: 'bottom-right',
        offset: { inline: 16, block: 16 },
        onDismiss,
      }),
      host,
    );

    const status = host.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.textContent).toContain('Edited 1 file');

    (host.querySelector('[data-action="review-diffs"]') as HTMLButtonElement).click();
    expect(onAction).toHaveBeenCalledTimes(1);

    (host.querySelector('[data-action="dismiss-notice"]') as HTMLButtonElement).click();
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });
});

describe('overlay toasts', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    vi.clearAllMocks();
  });

  it('shows a status toast whose action and dismiss buttons work', async () => {
    const workspace = createFakeWorkspace({
      summary,
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'file_edit', { filePath: 'src/App.tsx' }));
          emit(runEvent(message.requestId, 'chunk', { text: 'Updated', segment: 0 }));
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
    await vi.waitFor(() => expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('Edited 1 file'));

    (shadow?.querySelector('[data-action="dismiss-notice"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[role="status"]')?.textContent ?? '').not.toContain('Edited 1 file');
  });
});

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
