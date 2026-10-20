import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffSummary } from '@gateway/shared-types';

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

import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import type { DevtoolsBridge, GatewayBridge } from '../src/types.js';

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
    const bridge = fakeBridge();
    const host = initDevtools({ client: idleClient(), bridge, cwd: '/repo' });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="diffs"]')?.getAttribute('data-count')).toBe('1'));
    expect(shadow?.querySelector('[data-action="diffs"]')?.textContent).toContain('1');

    (shadow?.querySelector('[data-action="diffs"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeTruthy();
    expect(shadow?.textContent).toContain('src/App.tsx');

    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Terminal"]')).toBeTruthy();
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeNull();
    await vi.waitFor(() => expect(bridge.spawnPty).toHaveBeenCalled());

    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Tests"]')).toBeTruthy();
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-status="passed"]')).toBeTruthy());
    expect(shadow?.textContent).toContain('1 passed');

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('textarea')).toBeTruthy();
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('textarea')).toBeNull();
  });

  it('asks for a diff review after the agent edits a file', async () => {
    const client: GatewayBridge = {
      async checkHealth() {
        return true;
      },
      async streamPrompt(input) {
        input.onFileEdit?.('src/App.tsx');
        input.onChunk?.('Updated the button');
        input.onDone?.();
      },
      cancel() {},
    };
    const host = initDevtools({ client, bridge: fakeBridge(), cwd: '/repo' });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Review the diffs'));
    (shadow?.querySelector('[data-action="review-diffs"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[aria-label="Diffs"]')).toBeTruthy();
    expect(shadow?.textContent).not.toContain('Review the diffs');
  });
});

function fakeBridge(): DevtoolsBridge & { spawnPty: ReturnType<typeof vi.fn> } {
  return {
    async gitDiff() {
      return summary;
    },
    async gitCommit() {
      return { commitHash: 'abc1234', branch: 'main' };
    },
    async gitRevert() {},
    async runTests(onLine) {
      onLine('1 passed');
      return { exitCode: 0, command: 'pnpm test' };
    },
    spawnPty: vi.fn(async () => ({ sessionId: 'pty_test', fallback: false })),
    writePty() {},
    resizePty() {},
    disposePty() {},
    onPtyData() {
      return () => {};
    },
    onPtyExit() {
      return () => {};
    },
  };
}

function idleClient(): GatewayBridge {
  return {
    async checkHealth() {
      return false;
    },
    async streamPrompt() {},
    cancel() {},
  };
}
