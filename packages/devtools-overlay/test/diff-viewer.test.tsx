import { h, options, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffSummary } from '@gateway/shared-types';
import { DiffViewer } from '../src/ui/DiffViewer.js';

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
          content: ' const value = 1;\n-const color = "blue";\n+const color = "emerald";\n return value;',
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
    const onCommit = vi.fn(async () => ({ commitHash: 'abc1234def', branch: 'main' }));
    const onDiscard = vi.fn(async () => {});
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(DiffViewer, {
        summary,
        loading: false,
        error: null,
        onCommit,
        onDiscard,
        onClose: () => {},
      }),
      host,
    );

    expect(host.textContent).toContain('src/App.tsx');
    expect(host.textContent).toContain('+1');
    expect(host.textContent).toContain('-1');
    expect(host.textContent).toContain('emerald');
    expect(host.querySelector('.diff-add')?.textContent).toContain('emerald');
    expect(host.querySelector('.diff-del')?.textContent).toContain('blue');

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
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit).toHaveBeenCalledWith({
      message: 'feat: emerald button',
      push: true,
      files: ['src/App.tsx', 'src/Hero.tsx'],
    });
    expect(host.textContent).toContain('abc1234');

    (host.querySelector('[data-action="discard"]') as HTMLButtonElement).click();
    expect(host.textContent).toContain('Discard uncommitted changes?');
    (host.querySelector('[data-action="confirm-discard"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onDiscard).toHaveBeenCalledWith(['src/App.tsx', 'src/Hero.tsx']));
  });
});
