import type { GitDiffSummary, UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import {
  BOTTOM_DEFAULT,
  BOTTOM_MIN,
  SIDE_CHAT_DEFAULT,
  SIDE_MAX,
  SIDE_MIN,
  clampBottomHeight,
  clampSideWidth,
  isCompactViewport,
  isSheetViewport,
  reviewDefaultWidth,
  snapCorner,
} from '../src/ui/layout/geometry.js';
import { createFakeWorkspace } from './fake-workspace.js';

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

describe('dock layout geometry', () => {
  it('clamps resize ranges and classifies viewports', () => {
    expect(clampSideWidth(200)).toBe(SIDE_MIN);
    expect(clampSideWidth(1200)).toBe(SIDE_MAX);
    expect(clampSideWidth(500)).toBe(500);
    expect(clampBottomHeight(80, 900)).toBe(BOTTOM_MIN);
    expect(clampBottomHeight(800, 900)).toBe(630);
    expect(clampBottomHeight(BOTTOM_DEFAULT, 900)).toBe(BOTTOM_DEFAULT);
    expect(reviewDefaultWidth(1440)).toBe(720);
    expect(reviewDefaultWidth(800)).toBe(640);
    expect(isCompactViewport(390)).toBe(true);
    expect(isCompactViewport(640)).toBe(false);
    expect(isSheetViewport(767)).toBe(true);
    expect(isSheetViewport(768)).toBe(false);
    expect(snapCorner(10, 10, 1000, 800)).toBe('top-left');
    expect(snapCorner(900, 700, 1000, 800)).toBe('bottom-right');
  });
});

describe('overlay docks', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.documentElement.style.marginRight = '';
    document.documentElement.style.paddingBottom = '';
    stubViewport(1024, 768);
    vi.clearAllMocks();
  });

  it('sets and restores documentElement push styles', () => {
    document.documentElement.style.marginRight = '5px';
    document.documentElement.style.paddingBottom = '7px';
    const host = initDevtools({ workspace: createFakeWorkspace({ summary }), dock: 'push' });
    const shadow = host?.shadowRoot;
    expect(document.documentElement.style.marginRight).toBe('5px');

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(document.documentElement.style.marginRight).toBe(`${SIDE_CHAT_DEFAULT}px`);
    expect(document.documentElement.style.paddingBottom).toBe('7px');

    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    expect(document.documentElement.style.paddingBottom).toBe(`${BOTTOM_DEFAULT}px`);
    expect(document.documentElement.style.marginRight).toBe(`${SIDE_CHAT_DEFAULT}px`);

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(document.documentElement.style.marginRight).toBe('5px');
    expect(document.documentElement.style.paddingBottom).toBe(`${BOTTOM_DEFAULT}px`);

    host?.remove();
    expect(document.documentElement.style.marginRight).toBe('5px');
    expect(document.documentElement.style.paddingBottom).toBe('7px');
  });

  it('does not push the page in overlay mode', () => {
    document.documentElement.style.marginRight = '9px';
    const host = initDevtools({ workspace: createFakeWorkspace({ summary }), dock: 'overlay' });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    expect(document.documentElement.style.marginRight).toBe('9px');
    expect(document.documentElement.style.paddingBottom).toBe('');
    expect(shadow?.querySelector('.side-dock')).toBeTruthy();
    expect(shadow?.querySelector('.bottom-dock')).toBeTruthy();
  });

  it('clamps keyboard resize on the side handle', () => {
    const host = initDevtools({ workspace: createFakeWorkspace({ summary }) });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const handle = shadow?.querySelector('[aria-label="Resize side dock"]') as HTMLElement;
    expect(handle).toBeTruthy();
    const dock = () => shadow?.querySelector('.side-dock') as HTMLElement;
    expect(dock().style.width).toBe(`${SIDE_CHAT_DEFAULT}px`);

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(dock().style.width).toBe('436px');

    for (let i = 0; i < 40; i += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    }
    expect(dock().style.width).toBe(`${SIDE_MAX}px`);

    for (let i = 0; i < 80; i += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    expect(dock().style.width).toBe(`${SIDE_MIN}px`);
  });

  it('closes inspect then the bottom dock then the side dock on Esc', () => {
    const host = initDevtools({ workspace: createFakeWorkspace({ summary }) });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[data-action="inspect"]')?.getAttribute('aria-pressed')).toBe('true');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow?.querySelector('[data-action="inspect"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(shadow?.querySelector('.bottom-dock:not([hidden])')).toBeTruthy();
    expect(shadow?.querySelector('.side-dock')).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow?.querySelector('.bottom-dock:not([hidden])')).toBeNull();
    expect(shadow?.querySelector('.side-dock')).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow?.querySelector('.side-dock')).toBeNull();
  });

  it('renders bottom sheets and skips push under 768px, with an icons-only pill at 390px', () => {
    stubViewport(390, 844);
    const host = initDevtools({ workspace: createFakeWorkspace({ summary }), dock: 'push' });
    const shadow = host?.shadowRoot;
    expect(shadow?.querySelector('.pill')?.classList.contains('pill-compact')).toBe(true);
    expect(isCompactViewport(390)).toBe(true);

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const side = shadow?.querySelector('.side-dock');
    expect(side?.classList.contains('sheet')).toBe(true);
    expect(document.documentElement.style.marginRight).toBe('');
    expect(shadow?.querySelector('.empty-title')?.textContent).toContain('Edit this page');

    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('.side-dock')).toBeNull();
    expect(shadow?.querySelector('.bottom-dock')?.classList.contains('sheet')).toBe(true);
    expect(shadow?.querySelector('.empty-title')?.textContent).toBe('No results yet');
    expect(document.documentElement.style.paddingBottom).toBe('');
  });

  it('dismisses the review toast when git.changed reports no files', async () => {
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
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Review the diffs'));

    workspace.emit({ type: 'git.changed', summary: { files: [], insertions: 0, deletions: 0 } });
    await vi.waitFor(() => expect(shadow?.textContent).not.toContain('Review the diffs'));
  });

  it('hides commit controls when the review list is empty', async () => {
    const host = initDevtools({
      workspace: createFakeWorkspace({ summary: { files: [], insertions: 0, deletions: 0 } }),
    });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="diffs"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('.empty-title')?.textContent).toBe('No changes yet'));
    expect(shadow?.querySelector('[data-action="commit"]')).toBeNull();
    expect(shadow?.querySelector('[data-action="discard"]')).toBeNull();
    expect(shadow?.querySelector('[aria-label="Commit message"]')).toBeNull();
  });
});

function stubViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)/.exec(query);
    const min = /min-width:\s*(\d+)/.exec(query);
    let matches = false;
    if (max) matches = width <= Number(max[1]);
    if (min) matches = width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
      onchange: null,
    };
  }) as typeof window.matchMedia;
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
