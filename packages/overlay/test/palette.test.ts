import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { trapFocus } from '../src/ui/focus-trap.js';
import { isEditableTarget, isInspectChord, isPaletteChord } from '../src/ui/keyboard.js';
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

describe('keyboard helpers', () => {
  it('detects the palette chord and editable host targets', () => {
    expect(isPaletteChord(chord('k'))).toBe(true);
    expect(isPaletteChord(chord('k', { shiftKey: true }))).toBe(false);
    expect(isInspectChord(chord('c', { shiftKey: true }))).toBe(true);

    const text = document.createElement('input');
    expect(isEditableTarget(text)).toBe(true);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});

describe('focus trap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('cycles Tab within the container', () => {
    const root = document.createElement('div');
    const first = document.createElement('button');
    const last = document.createElement('button');
    first.textContent = 'first';
    last.textContent = 'last';
    root.append(first, last);
    document.body.append(root);
    const release = trapFocus(root);

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);

    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    release();
  });
});

describe('command palette', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.querySelectorAll('input').forEach((node) => node.remove());
    vi.clearAllMocks();
  });

  it('opens on ⌘K/Ctrl+K, filters, and Enter runs the highlighted action', () => {
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    window.dispatchEvent(chord('k'));
    const palette = shadow?.querySelector('[data-action="command-palette"]');
    expect(palette).toBeTruthy();

    const search = shadow?.querySelector('[data-action="palette-search"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(shadow?.activeElement ?? search).toBe(search);

    search.value = 'term';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shadow?.querySelector('[data-command="terminal"]')?.getAttribute('aria-selected')).toBe('true');
    expect(shadow?.querySelector('[data-command="inspect"]')).toBeNull();

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(shadow?.querySelector('[data-action="command-palette"]')).toBeNull();
    expect(shadow?.querySelector('.bottom-dock:not([hidden])')).toBeTruthy();
    expect(shadow?.querySelector('section[aria-label="Terminal"]')).toBeTruthy();
  });

  it('closes the palette on Esc before docks', () => {
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    window.dispatchEvent(chord('k'));
    expect(shadow?.querySelector('[data-action="command-palette"]')).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(shadow?.querySelector('[data-action="command-palette"]')).toBeNull();
    expect(shadow?.querySelector('.bottom-dock:not([hidden])')).toBeTruthy();
    expect(shadow?.querySelector('.side-dock')).toBeTruthy();
  });

  it('traps focus inside the open palette', async () => {
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    window.dispatchEvent(chord('k'));
    const dialog = shadow?.querySelector('[data-action="command-palette"]') as HTMLElement;
    const search = shadow?.querySelector('[data-action="palette-search"]') as HTMLInputElement;
    expect(dialog).toBeTruthy();
    expect(search).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));

    search.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
  });

  it('ignores shortcuts while typing in a host page input except ⌘K', () => {
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    input.dispatchEvent(chord('c', { shiftKey: true }));
    expect(shadow?.querySelector('[data-action="inspect"]')?.getAttribute('aria-pressed')).not.toBe('true');

    input.dispatchEvent(chord('k'));
    expect(shadow?.querySelector('[data-action="command-palette"]')).toBeTruthy();
  });
});

function chord(key: string, extra: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...extra,
  });
}
