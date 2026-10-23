import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
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

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('console panel', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('badges errors, opens the console, and Fix with AI prefills chat without sending', async () => {
    console.error = (() => undefined) as typeof console.error;
    const workspace = createFakeWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    console.error('checkout exploded');
    window.onerror?.('boom', 'src/App.tsx', 12, 3, new Error('boom'));
    await vi.waitFor(() =>
      expect(Number(shadow?.querySelector('[data-action="error-badge"]')?.getAttribute('data-count'))).toBeGreaterThanOrEqual(
        1,
      ),
    );

    (shadow?.querySelector('[data-action="error-badge"]') as HTMLElement).click();
    expect(shadow?.querySelector('section[aria-label="Console"]')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="console-filter-all"]')).toBeTruthy();

    const source = shadow?.querySelector('[data-action="open-source"]') as HTMLButtonElement | null;
    expect(source).toBeTruthy();
    source?.click();
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'editor.open')).toBe(true));
    expect(workspace.sent.find((message) => message.type === 'editor.open')).toMatchObject({
      type: 'editor.open',
      file: expect.stringContaining('App.tsx'),
      line: 12,
    });

    (shadow?.querySelector('[data-action="fix-with-ai"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Fix this error');
    expect(shadow?.querySelector('[data-chip="console"]')).toBeTruthy();
    expect(workspace.sent.some((message) => message.type === 'run.start')).toBe(false);
  });

  it('filters warnings away from the Errors tab', async () => {
    console.warn = (() => undefined) as typeof console.warn;
    console.error = (() => undefined) as typeof console.error;
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    console.warn('inventory low');
    console.error('checkout failed');
    (shadow?.querySelector('[data-action="console"]') as HTMLButtonElement).click();
    expect(shadow?.textContent).toContain('inventory low');
    expect(shadow?.textContent).toContain('checkout failed');
    (shadow?.querySelector('[data-action="console-filter-error"]') as HTMLButtonElement).click();
    expect(shadow?.textContent).not.toContain('inventory low');
    expect(shadow?.textContent).toContain('checkout failed');
    (shadow?.querySelector('[data-action="console-filter-warn"]') as HTMLButtonElement).click();
    expect(shadow?.textContent).toContain('inventory low');
    expect(shadow?.textContent).not.toContain('checkout failed');
  });
});
