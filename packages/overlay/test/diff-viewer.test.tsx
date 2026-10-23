import type { GitDiffSummary, GitStatus, WorkspaceServerMessage } from '@aidev/protocol';
import { h, options, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_CSS } from '../src/styles.js';
import { DiffViewer, type ReviewScope } from '../src/ui/DiffViewer.js';
import type { DiffViewMode } from '../src/ui/prefs.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

const twoHunkFile = {
  path: 'src/App.tsx',
  status: 'modified' as const,
  additions: 2,
  deletions: 2,
  hunks: [
    {
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 3,
      content: ` const value = 1;\n-const color = "blue";\n+const color = "emerald";\n+${'x'.repeat(200)}\n return value;`,
    },
    {
      oldStart: 40,
      oldLines: 2,
      newStart: 40,
      newLines: 2,
      content: `-const extra = true;\n+const extra = false;`,
    },
  ],
};

const summary: GitDiffSummary = {
  branch: 'main',
  insertions: 3,
  deletions: 2,
  files: [
    twoHunkFile,
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
          content: '+export function Hero() {\n+  return <div className="ok">hi</div>;\n}',
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
    const host = mountReview({ workspace });

    expect(host.textContent).toContain('src/App.tsx');
    expect(host.textContent).toContain('+2');
    expect(host.textContent).toContain('-2');
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
    const longLine = [...(host.querySelectorAll('.diff-line code') ?? [])].find((node) =>
      (node.textContent ?? '').includes('x'.repeat(200)),
    );
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

    const message = host.querySelector('[aria-label="Commit message"]') as HTMLTextAreaElement;
    message.value = 'feat: emerald button';
    message.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="commit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.some((item) => item.type === 'git.commit')).toBe(true));
    expect(workspace.sent.find((item) => item.type === 'git.commit')).toMatchObject({
      message: 'feat: emerald button',
      push: false,
      paths: ['src/App.tsx', 'src/Hero.tsx'],
    });
    expect(host.textContent).toContain('abc1234');

    const discard = host.querySelector('[data-action="discard-selected"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(discard.disabled).toBe(false));
    discard.click();
    expect(host.textContent).toContain('Discard uncommitted changes?');
    (host.querySelector('[data-action="confirm-discard"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(workspace.sent.find((item) => item.type === 'git.discard')).toMatchObject({
        paths: ['src/App.tsx', 'src/Hero.tsx'],
      }),
    );
  });

  it('filters to this-run files when the scope is This run', () => {
    const host = mountReview({
      scope: 'run',
      runFiles: ['src/App.tsx'],
    });
    expect(host.querySelector('[data-action="review-scope-run"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-file="src/App.tsx"]')).toBeTruthy();
    expect(host.querySelector('[data-file="src/Hero.tsx"]')).toBeNull();

    (host.querySelector('[data-action="review-scope-all"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-file="src/Hero.tsx"]')).toBeTruthy();
  });

  it('sends the hunk index when discarding a hunk on the second click', async () => {
    const workspace = createFakeWorkspace();
    const host = mountReview({ workspace });
    const hunkButton = () =>
      host.querySelector('[data-action="discard-hunk"][data-hunk-index="1"]') as HTMLButtonElement;
    expect(hunkButton()).toBeTruthy();
    hunkButton().click();
    expect(hunkButton().textContent).toContain('Confirm discard');
    expect(workspace.sent.some((item) => item.type === 'git.discard.hunk')).toBe(false);
    hunkButton().click();
    await vi.waitFor(() => expect(workspace.sent.some((item) => item.type === 'git.discard.hunk')).toBe(true));
    expect(workspace.sent.find((item) => item.type === 'git.discard.hunk')).toMatchObject({
      type: 'git.discard.hunk',
      path: 'src/App.tsx',
      hunkIndex: 1,
    });
  });

  it('fills the commit message from generate', async () => {
    const workspace = createFakeWorkspace();
    const host = mountReview({ workspace });
    (host.querySelector('[data-action="generate-commit"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect((host.querySelector('[aria-label="Commit message"]') as HTMLTextAreaElement).value).toBe(
        'feat: generated message',
      ),
    );
    expect(workspace.sent.find((item) => item.type === 'commit.suggest')).toMatchObject({
      paths: ['src/App.tsx', 'src/Hero.tsx'],
    });
  });

  it('creates a branch from the inline input', async () => {
    const workspace = createFakeWorkspace();
    const host = mountReview({ workspace, suggestedBranch: 'aidev/emerald' });
    (host.querySelector('[data-action="new-branch"]') as HTMLButtonElement).click();
    const input = host.querySelector('[aria-label="New branch name"]') as HTMLInputElement;
    expect(input.value).toBe('aidev/emerald');
    input.value = 'aidev/review';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="create-branch"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.some((item) => item.type === 'git.branch.create')).toBe(true));
    expect(workspace.sent.find((item) => item.type === 'git.branch.create')).toMatchObject({
      name: 'aidev/review',
    });
  });

  it('shows the pull request URL after Open PR', async () => {
    const toasts: Array<{ text: string }> = [];
    const workspace = createFakeWorkspace({
      onRequest(message) {
        if (message.type === 'git.status') {
          return statusReply(message.requestId, {
            branch: 'aidev/review',
            clean: false,
            conflicted: [],
            dirty: ['src/App.tsx'],
            ghAvailable: true,
          });
        }
        return undefined;
      },
    });
    const host = mountReview({ workspace, onToast: (toast) => toasts.push(toast) });
    await vi.waitFor(() => expect(host.querySelector('[data-action="open-pr"]')).toBeTruthy());
    const message = host.querySelector('[aria-label="Commit message"]') as HTMLTextAreaElement;
    message.value = 'feat: open the pr';
    message.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="open-pr"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(host.querySelector('[data-action="pr-url"]')?.textContent).toContain('github.com'));
    expect(workspace.sent.find((item) => item.type === 'git.pr.create')).toMatchObject({
      title: 'feat: open the pr',
      base: 'main',
    });
    expect(toasts.some((toast) => toast.text.includes('https://github.com/example/demo/pull/1'))).toBe(true);
  });

  it('renders two columns in split view', () => {
    const host = mountReview({ viewMode: 'split' });
    expect(host.querySelector('.diff-split')).toBeTruthy();
    expect(host.querySelector('[data-side="old"]')).toBeTruthy();
    expect(host.querySelector('[data-side="new"]')).toBeTruthy();
    const split = host.querySelector('.diff-split');
    expect(split?.querySelectorAll('.diff-split-pane')).toHaveLength(2);
  });

  it('disables Commit & Push when there is no upstream', async () => {
    const host = mountReview();
    await vi.waitFor(() => expect(host.querySelector('[data-action="commit-push"]')).toBeTruthy());
    const push = host.querySelector('[data-action="commit-push"]') as HTMLButtonElement;
    expect(push.disabled).toBe(true);
    expect(push.title).toContain('No upstream remote');
  });
});

function mountReview(
  options: {
    workspace?: ReturnType<typeof createFakeWorkspace>;
    scope?: ReviewScope;
    runFiles?: string[];
    viewMode?: DiffViewMode;
    suggestedBranch?: string;
    onToast?: (toast: { text: string; tone?: 'info' | 'error' }) => void;
  } = {},
): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const scope = { current: options.scope ?? 'all' };
  const view = { current: options.viewMode ?? 'unified' };
  const renderReview = (): void => {
    render(
      h(DiffViewer, {
        workspace: options.workspace ?? createFakeWorkspace(),
        summary,
        loading: false,
        error: null,
        scope: scope.current,
        runFiles: options.runFiles ?? [],
        onScopeChange: (next) => {
          scope.current = next;
          renderReview();
        },
        viewMode: view.current,
        onViewModeChange: (next) => {
          view.current = next;
          renderReview();
        },
        ...(options.onToast ? { onToast: options.onToast } : {}),
        ...(options.suggestedBranch ? { suggestedBranch: options.suggestedBranch } : {}),
      }),
      host,
    );
  };
  renderReview();
  return host;
}

function statusReply(requestId: string | undefined, status: GitStatus): WorkspaceServerMessage {
  return { type: 'git.status.result', requestId, status };
}
