import type { GitDiffSummary } from '@aidev/protocol';
import { h, options, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_CSS } from '../src/styles.js';
import { DiffViewer } from '../src/ui/DiffViewer.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

const summary: GitDiffSummary = {
  branch: 'main',
  insertions: 1,
  deletions: 1,
  files: [
    {
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 1,
      hunks: [
        {
          oldStart: 10,
          oldLines: 3,
          newStart: 10,
          newLines: 3,
          content: ` const value = 1;\n-const color = "blue";\n+const color = "emerald";\n+${'x'.repeat(200)}\n return value;`,
        },
      ],
    },
    {
      path: 'src/Hero.tsx',
      status: 'added',
      additions: 2,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          content: '+export function Hero() {\n+  return null;\n}',
        },
      ],
    },
  ],
};

describe('DiffViewer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders modified files, hunk colors, and commit or discard actions', async () => {
    const workspace = createFakeWorkspace();
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(DiffViewer, {
        workspace,
        summary,
        loading: false,
        error: null,
      }),
      host,
    );

    expect(host.textContent).toContain('src/App.tsx');
    expect(host.textContent).toContain('+1');
    expect(host.textContent).toContain('-1');
    expect(host.textContent).toContain('emerald');
    expect(host.querySelector('.diff-add')?.textContent).toContain('emerald');
    expect(host.querySelector('.diff-del')?.textContent).toContain('blue');
    expect(host.querySelector('.file-status')?.textContent).toBe('modified');
    expect(host.querySelector('.file-sep')?.textContent).toBe('·');
    expect(host.querySelector('.file-path')?.textContent).toBe('src/App.tsx');
    const contextLine = host.querySelector('.diff-ctx');
    const numbers = contextLine?.querySelectorAll('.ln');
    expect(numbers).toHaveLength(2);
    expect(numbers?.[0]?.textContent).toBe('10');
    expect(numbers?.[1]?.textContent).toBe('10');
    const longLine = [...(host.querySelectorAll('.diff-line code') ?? [])].find((node) => (node.textContent ?? '').includes('x'.repeat(200)));
    expect(longLine?.textContent).toContain('x'.repeat(200));
    expect(OVERLAY_CSS).toContain('grid-template-columns: 4ch 4ch max-content');
    expect(OVERLAY_CSS).toContain('white-space: pre');
    expect(OVERLAY_CSS).toContain('overflow-x: auto');
    expect(OVERLAY_CSS).toMatch(/\.diff-layout \{[^}]*min-width: 0/s);
    expect(OVERLAY_CSS).toMatch(/\.diff-view \{[^}]*min-width: 0/s);
    expect(OVERLAY_CSS).toMatch(/\.hunk \{[^}]*min-width: 0/s);

    const hero = host.querySelector('[data-file="src/Hero.tsx"]') as HTMLButtonElement;
    hero.click();
    expect(host.textContent).toContain('export function Hero()');

    const message = host.querySelector('[aria-label="Commit message"]') as HTMLInputElement;
    message.value = 'feat: emerald button';
    message.dispatchEvent(new Event('input', { bubbles: true }));
    const push = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    push.checked = true;
    push.dispatchEvent(new Event('change', { bubbles: true }));
    (host.querySelector('[data-action="commit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'git.commit')).toBe(true));
    expect(workspace.sent.find((message) => message.type === 'git.commit')).toMatchObject({
      message: 'feat: emerald button',
      push: true,
      paths: ['src/App.tsx', 'src/Hero.tsx'],
    });
    expect(host.textContent).toContain('abc1234');

    (host.querySelector('[data-action="discard"]') as HTMLButtonElement).click();
    expect(host.textContent).toContain('Discard uncommitted changes?');
    (host.querySelector('[data-action="confirm-discard"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(workspace.sent.find((message) => message.type === 'git.discard')).toMatchObject({
        paths: ['src/App.tsx', 'src/Hero.tsx'],
      }),
    );
  });
});
