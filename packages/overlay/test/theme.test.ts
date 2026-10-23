import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { options } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { OVERLAY_CSS } from '../src/styles.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

describe('design tokens', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
  });

  it('applies the token font stack to toolbar, chat, and diff text', () => {
    expect(OVERLAY_CSS).toContain('--aid-font: ui-sans-serif');
    expect(OVERLAY_CSS).toContain('--aid-mono: ui-monospace');
    expect(OVERLAY_CSS).toMatch(/:host \*\s*\{\s*font-family:\s*var\(--aid-font\)/);
    expect(OVERLAY_CSS).toMatch(/button, textarea, select, input \{[\s\S]*?font-family: var\(--aid-font\)/);
    expect(OVERLAY_CSS).toMatch(/\.toolbar button \{/);
    expect(OVERLAY_CSS).toMatch(/\.composer textarea \{[\s\S]*?font-family: var\(--aid-font\)/);
    expect(OVERLAY_CSS).toMatch(/\.diff-line code \{[\s\S]*?font-family: var\(--aid-mono\)/);
    expect(OVERLAY_CSS).not.toMatch(/font-size:\s*(?:1[01]|[0-9])px\b/);
  });

  it('keeps raw hex colors inside tokens.ts only', () => {
    const overlayRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const styleDir = join(overlayRoot, 'src/ui/styles');
    const offenders: string[] = [];
    for (const file of readdirSync(styleDir)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join(styleDir, file), 'utf8');
      if (HEX.test(source)) offenders.push(`src/ui/styles/${file}`);
    }
    const barrel = readFileSync(join(overlayRoot, 'src/styles.ts'), 'utf8');
    if (HEX.test(barrel)) offenders.push('src/styles.ts');
    expect(offenders).toEqual([]);
    const tokens = readFileSync(join(overlayRoot, 'src/ui/theme/tokens.ts'), 'utf8');
    expect(tokens).toMatch(HEX);
  });

  it('labels every icon-only button', () => {
    const host = initDevtools({ workspace: createFakeWorkspace() });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    assertIconButtons(shadow, ['close-chat']);

    (shadow?.querySelector('[data-action="diffs"]') as HTMLButtonElement).click();
    assertIconButtons(shadow, ['close-diffs']);

    (shadow?.querySelector('[data-action="terminal"]') as HTMLButtonElement).click();
    assertIconButtons(shadow, ['close-terminal']);

    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    assertIconButtons(shadow, ['close-tests']);
  });

  it('defaults data-theme to dark and honors config.theme', () => {
    const dark = initDevtools({ workspace: createFakeWorkspace() });
    expect(dark?.getAttribute('data-theme')).toBe('dark');
    dark?.remove();
    const light = initDevtools({ workspace: createFakeWorkspace(), theme: 'light' });
    expect(light?.getAttribute('data-theme')).toBe('light');
    expect(light?.style.color.toLowerCase()).toBe('#1a1d24');
  });
});

function assertIconButtons(root: ShadowRoot | null | undefined, actions: string[]): void {
  expect(root).toBeTruthy();
  for (const action of actions) {
    const button = root?.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null;
    expect(button, action).toBeTruthy();
    expect(button?.getAttribute('aria-label'), action).toBeTruthy();
    expect(button?.getAttribute('title'), action).toBeTruthy();
  }
  const icons = [...(root?.querySelectorAll('button.icon-button') ?? [])];
  expect(icons.length).toBeGreaterThan(0);
  for (const button of icons) {
    const action = button.getAttribute('data-action') ?? 'icon-button';
    expect(button.getAttribute('aria-label'), action).toBeTruthy();
    expect(button.getAttribute('title'), action).toBeTruthy();
  }
}
