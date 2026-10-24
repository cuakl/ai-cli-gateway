import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GitDiffFile, GitDiffHunk, GitDiffSummary, GitLogEntry, GitStatus } from '@aidev/protocol';
import { EmptyState } from './EmptyState.js';
import { languageFromPath } from './diff/language.js';
import { LazyHighlight } from './diff/LazyHighlight.js';
import { GitCompareIcon, LoaderIcon, SparklesIcon } from './icons.js';
import { isEditableTarget } from './keyboard.js';
import type { DiffViewMode } from './prefs.js';
import type { WorkspaceConnection } from './workspace-client.js';

export type ReviewScope = 'run' | 'all';

export interface ReviewToast {
  text: string;
  tone?: 'info' | 'error';
}

export interface DiffViewerProps {
  workspace: WorkspaceConnection;
  summary: GitDiffSummary | null;
  loading: boolean;
  error: string | null;
  scope: ReviewScope;
  runFiles: readonly string[];
  onScopeChange: (scope: ReviewScope) => void;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  onToast?: (toast: ReviewToast) => void;
  suggestedBranch?: string;
}

const DEFAULT_BRANCHES = new Set(['main', 'master']);

export function DiffViewer({
  workspace,
  summary,
  loading,
  error,
  scope,
  runFiles,
  onScopeChange,
  viewMode,
  onViewModeChange,
  onToast,
  suggestedBranch,
}: DiffViewerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>(() => (summary?.files ?? []).map((file) => file.path));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingHunk, setPendingHunk] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [branchDraft, setBranchDraft] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [hunkIndex, setHunkIndex] = useState(0);

  useEffect(() => {
    void import('./diff/Highlight.js');
  }, []);

  const listed = summary?.files;
  const files = useMemo(() => {
    const allFiles = listed ?? [];
    return scope === 'run' ? allFiles.filter((file) => matchesRunFile(file.path, runFiles)) : allFiles;
  }, [listed, runFiles, scope]);
  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const selectedPaths = files.filter((file) => checked.includes(file.path)).map((file) => file.path);
  const branch = gitStatus?.branch ?? summary?.branch ?? 'HEAD';
  const hasUpstream = gitStatus?.ahead !== undefined || gitStatus?.behind !== undefined;
  const showOpenPr = Boolean(gitStatus?.ghAvailable) && !DEFAULT_BRANCHES.has(branch);
  const lastSubject = message.trim().split('\n')[0] || commits[0]?.subject || '';
  const hunks = selected?.hunks ?? [];

  useEffect(() => {
    setSelectedPath((current) => {
      if (files.length === 0) return null;
      if (current && files.some((file) => file.path === current)) return current;
      return files[0]?.path ?? null;
    });
    setChecked((current) => {
      const visible = new Set(files.map((file) => file.path));
      const kept = current.filter((path) => visible.has(path));
      const added = files.map((file) => file.path).filter((path) => !current.includes(path));
      return kept.length === 0 && current.length === 0 ? files.map((file) => file.path) : [...kept, ...added];
    });
    setHunkIndex(0);
  }, [files]);

  useEffect(() => {
    let cancelled = false;
    void refreshMeta().then((next) => {
      if (!cancelled) applyMeta(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  async function refreshMeta(): Promise<{ status: GitStatus | null; commits: GitLogEntry[] }> {
    const [statusResult, logResult] = await Promise.allSettled([
      workspace.request({ type: 'git.status' }),
      workspace.request({ type: 'git.log', limit: 5 }),
    ]);
    return {
      status: statusResult.status === 'fulfilled' ? statusResult.value.status : null,
      commits: logResult.status === 'fulfilled' ? logResult.value.commits : [],
    };
  }

  function applyMeta(next: { status: GitStatus | null; commits: GitLogEntry[] }): void {
    if (next.status) setGitStatus(next.status);
    setCommits(next.commits);
  }

  function toast(next: ReviewToast): void {
    onToast?.(next);
  }

  async function commit(push: boolean): Promise<void> {
    const text = message.trim();
    if (!text || busy || selectedPaths.length === 0) return;
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      const result = await workspace.request({
        type: 'git.commit',
        message: text,
        paths: selectedPaths,
        push,
      });
      setMessage('');
      setPrUrl(null);
      const note = push
        ? `Committed ${shortHash(result.commitHash)} and pushed ${result.branch}.`
        : `Committed ${shortHash(result.commitHash)} on ${result.branch}.`;
      setStatus(note);
      setBusy(false);
      applyMeta(await refreshMeta());
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Commit failed');
      setBusy(false);
    }
  }

  async function discardSelected(): Promise<void> {
    if (busy || selectedPaths.length === 0) return;
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      await workspace.request({ type: 'git.discard', paths: selectedPaths });
      setConfirming(false);
      setStatus('Discarded uncommitted changes.');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Discard failed');
    } finally {
      setBusy(false);
    }
  }

  async function discardFile(path: string): Promise<void> {
    if (busy) return;
    if (pendingFile !== path) {
      setPendingFile(path);
      return;
    }
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      await workspace.request({ type: 'git.discard', paths: [path] });
      setPendingFile(null);
      setStatus(`Discarded ${path}.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Discard failed');
    } finally {
      setBusy(false);
    }
  }

  async function discardHunk(path: string, index: number): Promise<void> {
    if (busy) return;
    const key = hunkKey(path, index);
    if (pendingHunk !== key) {
      setPendingHunk(key);
      return;
    }
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      await workspace.request({ type: 'git.discard.hunk', path, hunkIndex: index });
      setPendingHunk(null);
      setStatus('Discarded hunk.');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Discard hunk failed');
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    if (suggesting || selectedPaths.length === 0) return;
    setSuggesting(true);
    setActionError(null);
    try {
      const result = await workspace.request({ type: 'commit.suggest', paths: selectedPaths });
      setMessage(result.message);
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Could not generate a commit message';
      setActionError(text);
      toast({ text, tone: 'error' });
    } finally {
      setSuggesting(false);
    }
  }

  async function createBranch(): Promise<void> {
    const name = (branchDraft ?? '').trim();
    if (!name || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await workspace.request({ type: 'git.branch.create', name });
      setBranchDraft(null);
      setGitStatus((current) => (current ? { ...current, branch: result.name } : current));
      applyMeta(await refreshMeta());
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not create branch');
    } finally {
      setBusy(false);
    }
  }

  async function openPr(): Promise<void> {
    if (busy || !showOpenPr) return;
    const title = lastSubject || 'Review changes';
    const body = message.includes('\n') ? message.trim().split('\n').slice(1).join('\n').trim() : '';
    setBusy(true);
    setActionError(null);
    try {
      const result = await workspace.request({
        type: 'git.pr.create',
        title,
        body,
        base: DEFAULT_BRANCHES.has(branch) ? 'main' : defaultBase(branch),
      });
      setPrUrl(result.url);
      toast({ text: `Opened pull request ${result.url}` });
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Could not open a pull request';
      setActionError(text);
      toast({ text, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function undoCommit(): Promise<void> {
    if (busy || !commits[0] || commits[0].pushed) return;
    setBusy(true);
    setActionError(null);
    try {
      await workspace.request({ type: 'git.commit.undo' });
      setStatus('Undid the last commit.');
      applyMeta(await refreshMeta());
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Undo commit failed');
    } finally {
      setBusy(false);
    }
  }

  function selectFileAt(index: number): void {
    const file = files[index];
    if (!file) return;
    setSelectedPath(file.path);
    setHunkIndex(0);
    const button = panelRef.current?.querySelector(`[data-file="${cssAttr(file.path)}"]`);
    if (button instanceof HTMLElement) button.focus();
  }

  function selectHunkAt(index: number): void {
    if (!selected || hunks.length === 0) return;
    const next = ((index % hunks.length) + hunks.length) % hunks.length;
    setHunkIndex(next);
    const node = panelRef.current?.querySelector(`[data-hunk="${cssAttr(hunkKey(selected.path, next))}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }

  function onReviewKey(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const fileIndex = selected ? files.findIndex((file) => file.path === selected.path) : 0;
    if (event.key === 'j') {
      event.preventDefault();
      selectFileAt(Math.min(files.length - 1, fileIndex + 1));
      return;
    }
    if (event.key === 'k') {
      event.preventDefault();
      selectFileAt(Math.max(0, fileIndex - 1));
      return;
    }
    if (event.key === ']') {
      event.preventDefault();
      selectHunkAt(hunkIndex + 1);
      return;
    }
    if (event.key === '[') {
      event.preventDefault();
      selectHunkAt(hunkIndex - 1);
    }
  }

  const empty = !loading && files.length === 0;
  const showCommit = files.length > 0 && selectedPaths.length > 0;

  return (
    <section
      ref={panelRef}
      className="panel"
      aria-label="Diffs"
      tabIndex={-1}
      onKeyDown={onReviewKey}
    >
      <div className="review-toolbar">
        <div className="review-scopes" role="group" aria-label="Review scope">
          <button
            type="button"
            data-action="review-scope-run"
            aria-pressed={scope === 'run'}
            onClick={() => onScopeChange('run')}
          >
            This run
          </button>
          <button
            type="button"
            data-action="review-scope-all"
            aria-pressed={scope === 'all'}
            onClick={() => onScopeChange('all')}
          >
            All changes
          </button>
        </div>
        <div className="review-views" role="group" aria-label="Diff view">
          <button
            type="button"
            data-action="diff-view-unified"
            aria-pressed={viewMode === 'unified'}
            onClick={() => onViewModeChange('unified')}
          >
            Unified
          </button>
          <button
            type="button"
            data-action="diff-view-split"
            aria-pressed={viewMode === 'split'}
            onClick={() => onViewModeChange('split')}
          >
            Split
          </button>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {actionError ? <p className="banner">{actionError}</p> : null}
      {status ? <p className="banner ok">{status}</p> : null}
      {prUrl ? (
        <p className="banner ok">
          <a href={prUrl} target="_blank" rel="noreferrer" data-action="pr-url">
            {prUrl}
          </a>
        </p>
      ) : null}
      {loading && files.length === 0 ? <p className="empty">Loading diff…</p> : null}
      {empty ? (
        <EmptyState
          icon={<GitCompareIcon size={24} />}
          title="No changes yet"
          hint={
            scope === 'run'
              ? 'This run has not changed any files still in the working tree.'
              : 'Edits from the agent will land here so you can review, commit, or discard them.'
          }
        />
      ) : null}
      {files.length > 0 ? (
        <div className="diff-layout">
          <div className="file-list" role="listbox" aria-label="Modified files">
            {files.map((file) => (
              <div key={file.path} className="file-row">
                <label className="file-check">
                  <input
                    type="checkbox"
                    checked={checked.includes(file.path)}
                    aria-label={`Include ${file.path}`}
                    onChange={(event) => {
                      const on = event.currentTarget.checked;
                      setChecked((current) =>
                        on ? [...current, file.path] : current.filter((path) => path !== file.path),
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  role="option"
                  data-file={file.path}
                  aria-selected={selected?.path === file.path}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <span className="file-name" title={file.path}>
                    {file.path}
                  </span>
                  <span className="file-stats">
                    <span className="stat-add">+{file.additions}</span>
                    <span className="stat-del">-{file.deletions}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="diff-view" data-view={viewMode}>
            {selected ? (
              <FileDiff
                file={selected}
                viewMode={viewMode}
                pendingHunk={pendingHunk}
                pendingFile={pendingFile}
                activeHunk={hunkIndex}
                busy={busy}
                onDiscardFile={() => {
                  void discardFile(selected.path);
                }}
                onDiscardHunk={(index) => {
                  void discardHunk(selected.path, index);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {showCommit ? (
        <form
          className="commit-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void commit(false);
          }}
        >
          <div className="commit-message-row">
            <textarea
              aria-label="Commit message"
              placeholder="Commit message"
              value={message}
              disabled={busy}
              rows={3}
              onInput={(event) => setMessage(event.currentTarget.value)}
            />
            <button
              type="button"
              className="ghost"
              data-action="generate-commit"
              disabled={busy || suggesting || selectedPaths.length === 0}
              onClick={() => {
                void generate();
              }}
            >
              {suggesting ? <LoaderIcon size={14} /> : <SparklesIcon size={14} />}
              Generate
            </button>
          </div>
          <div className="commit-meta">
            <span className="branch-indicator" data-branch={branch}>
              {branch}
            </span>
            {branchDraft === null ? (
              <button
                type="button"
                className="ghost"
                data-action="new-branch"
                disabled={busy}
                onClick={() => setBranchDraft(suggestedBranch || 'aidev/change')}
              >
                New branch…
              </button>
            ) : (
              <span className="branch-create">
                <input
                  aria-label="New branch name"
                  value={branchDraft}
                  disabled={busy}
                  onInput={(event) => setBranchDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void createBranch();
                    }
                    if (event.key === 'Escape') setBranchDraft(null);
                  }}
                />
                <button
                  type="button"
                  className="ghost"
                  data-action="create-branch"
                  disabled={busy || branchDraft.trim().length === 0}
                  onClick={() => {
                    void createBranch();
                  }}
                >
                  Create
                </button>
              </span>
            )}
            {showOpenPr ? (
              <button
                type="button"
                className="ghost"
                data-action="open-pr"
                disabled={busy || !lastSubject}
                onClick={() => {
                  void openPr();
                }}
              >
                Open PR
              </button>
            ) : null}
          </div>
          <div className="composer-actions">
            {confirming ? (
              <div className="confirm" role="alertdialog" aria-label="Discard changes">
                <span>Discard uncommitted changes?</span>
                <button type="button" className="ghost" data-action="cancel-discard" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  data-action="confirm-discard"
                  disabled={busy}
                  onClick={() => {
                    void discardSelected();
                  }}
                >
                  Discard changes
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="ghost"
                data-action="discard-selected"
                disabled={busy || selectedPaths.length === 0}
                onClick={() => setConfirming(true)}
              >
                Discard
              </button>
            )}
            <button
              type="submit"
              className="primary"
              data-action="commit"
              disabled={busy || message.trim().length === 0 || selectedPaths.length === 0}
            >
              Commit
            </button>
            <button
              type="button"
              className="primary"
              data-action="commit-push"
              disabled={busy || message.trim().length === 0 || selectedPaths.length === 0 || !hasUpstream}
              title={hasUpstream ? 'Commit and push to the upstream remote' : 'No upstream remote'}
              onClick={() => {
                void commit(true);
              }}
            >
              Commit & Push
            </button>
          </div>
        </form>
      ) : null}
      {commits.length > 0 ? (
        <div className="commit-log" aria-label="Recent commits">
          <p className="kicker">Recent commits</p>
          <ol>
            {commits.map((entry) => (
              <li key={entry.hash}>
                <code>{shortHash(entry.hash)}</code>
                <span>{entry.subject}</span>
                {entry.pushed ? <span className="muted">pushed</span> : null}
              </li>
            ))}
          </ol>
          {commits[0] && !commits[0].pushed ? (
            <button
              type="button"
              className="ghost"
              data-action="undo-commit"
              disabled={busy}
              onClick={() => {
                void undoCommit();
              }}
            >
              Undo last commit
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FileDiff({
  file,
  viewMode,
  pendingHunk,
  pendingFile,
  activeHunk,
  busy,
  onDiscardFile,
  onDiscardHunk,
}: {
  file: GitDiffFile;
  viewMode: DiffViewMode;
  pendingHunk: string | null;
  pendingFile: string | null;
  activeHunk: number;
  busy: boolean;
  onDiscardFile: () => void;
  onDiscardHunk: (index: number) => void;
}) {
  const language = languageFromPath(file.path);
  return (
    <div className="diff-file">
      <div className="diff-file-head">
        <span className="file-status">{file.status}</span>
        <span className="file-sep" aria-hidden="true">
          ·
        </span>
        <span className="file-path" title={file.path}>
          {file.path}
        </span>
        <button
          type="button"
          className="ghost"
          data-action="discard-file"
          data-file={file.path}
          disabled={busy}
          onClick={onDiscardFile}
        >
          {pendingFile === file.path ? 'Confirm discard' : 'Discard'}
        </button>
      </div>
      {file.binary ? <p className="empty">Binary file.</p> : null}
      {(file.hunks ?? []).map((hunk, index) => (
        <HunkView
          key={`${hunk.oldStart}-${hunk.newStart}-${index}`}
          hunk={hunk}
          path={file.path}
          index={index}
          language={language}
          viewMode={viewMode}
          pending={pendingHunk === hunkKey(file.path, index)}
          active={activeHunk === index}
          busy={busy}
          onDiscard={() => onDiscardHunk(index)}
        />
      ))}
    </div>
  );
}

function HunkView({
  hunk,
  path,
  index,
  language,
  viewMode,
  pending,
  active,
  busy,
  onDiscard,
}: {
  hunk: GitDiffHunk;
  path: string;
  index: number;
  language: string;
  viewMode: DiffViewMode;
  pending: boolean;
  active: boolean;
  busy: boolean;
  onDiscard: () => void;
}) {
  const rows = parseHunk(hunk);
  return (
    <div className={`hunk${active ? ' hunk-active' : ''}`} data-hunk={hunkKey(path, index)}>
      <div className="hunk-header">
        <span>
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        <button
          type="button"
          className={pending ? 'danger' : 'ghost'}
          data-action="discard-hunk"
          data-hunk-index={String(index)}
          data-path={path}
          disabled={busy}
          onClick={onDiscard}
        >
          {pending ? 'Confirm discard' : 'Discard hunk'}
        </button>
      </div>
      {viewMode === 'split' ? <SplitHunk rows={rows} language={language} /> : <UnifiedHunk rows={rows} language={language} />}
    </div>
  );
}

function UnifiedHunk({ rows, language }: { rows: DiffRow[]; language: string }) {
  return (
    <>
      {rows.map((row, index) => (
        <DiffLine key={index} row={row} language={language} columns="both" />
      ))}
    </>
  );
}

function SplitHunk({ rows, language }: { rows: DiffRow[]; language: string }) {
  const pairs = pairSplitRows(rows);
  return (
    <div className="diff-split">
      <div className="diff-split-pane" data-side="old">
        {pairs.map((pair, index) => (
          <DiffLine key={`old-${index}`} row={pair.left} language={language} columns="old" />
        ))}
      </div>
      <div className="diff-split-pane" data-side="new">
        {pairs.map((pair, index) => (
          <DiffLine key={`new-${index}`} row={pair.right} language={language} columns="new" />
        ))}
      </div>
    </div>
  );
}

function DiffLine({
  row,
  language,
  columns,
}: {
  row: DiffRow;
  language: string;
  columns: 'both' | 'old' | 'new';
}) {
  if (row.kind === 'empty') {
    return (
      <div className="diff-line diff-empty">
        <span className="ln" />
        <code> </code>
      </div>
    );
  }
  const showOld = columns !== 'new' && row.kind !== 'add' && row.kind !== 'meta';
  const showNew = columns !== 'old' && row.kind !== 'del' && row.kind !== 'meta';
  return (
    <div className={`diff-line diff-${row.kind}${columns === 'both' ? '' : ' diff-split-line'}`}>
      {columns === 'both' ? (
        <>
          <span className="ln">{showOld ? String(row.oldLine) : ''}</span>
          <span className="ln">{showNew ? String(row.newLine) : ''}</span>
        </>
      ) : (
        <span className="ln">{columns === 'old' ? (showOld ? String(row.oldLine) : '') : showNew ? String(row.newLine) : ''}</span>
      )}
      <code>
        <span className="diff-marker">{row.marker}</span>
        <LazyHighlight text={row.code} language={language} />
      </code>
    </div>
  );
}

interface DiffRow {
  kind: 'add' | 'del' | 'ctx' | 'meta' | 'empty';
  marker: string;
  code: string;
  oldLine?: number;
  newLine?: number;
  raw: string;
}

function parseHunk(hunk: GitDiffHunk): DiffRow[] {
  const lines = hunk.content === '' ? [] : hunk.content.split('\n');
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return lines.map((line) => {
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('\\') ? 'meta' : 'ctx';
    const prefixed = line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\');
    const row: DiffRow = {
      kind,
      marker: prefixed ? (line[0] ?? ' ') : ' ',
      code: prefixed ? line.slice(1) : line,
      raw: line || ' ',
    };
    if (kind !== 'add' && kind !== 'meta') {
      row.oldLine = oldLine;
      oldLine += 1;
    }
    if (kind !== 'del' && kind !== 'meta') {
      row.newLine = newLine;
      newLine += 1;
    }
    return row;
  });
}

function pairSplitRows(rows: DiffRow[]): Array<{ left: DiffRow; right: DiffRow }> {
  const pairs: Array<{ left: DiffRow; right: DiffRow }> = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (!row) break;
    if (row.kind === 'ctx' || row.kind === 'meta') {
      pairs.push({ left: row, right: row });
      index += 1;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (index < rows.length && rows[index]?.kind === 'del') {
      const next = rows[index];
      if (next) dels.push(next);
      index += 1;
    }
    while (index < rows.length && rows[index]?.kind === 'add') {
      const next = rows[index];
      if (next) adds.push(next);
      index += 1;
    }
    const count = Math.max(dels.length, adds.length);
    for (let offset = 0; offset < count; offset += 1) {
      pairs.push({
        left: dels[offset] ?? emptyRow(),
        right: adds[offset] ?? emptyRow(),
      });
    }
  }
  return pairs;
}

function emptyRow(): DiffRow {
  return { kind: 'empty', marker: ' ', code: '', raw: ' ' };
}

function matchesRunFile(path: string, runFiles: readonly string[]): boolean {
  if (runFiles.length === 0) return false;
  const normalized = normalizePath(path);
  return runFiles.some((file) => {
    const other = normalizePath(file);
    return normalized === other || normalized.endsWith(`/${other}`) || other.endsWith(`/${normalized}`);
  });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hunkKey(path: string, index: number): string {
  return `${path}:${index}`;
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function defaultBase(branch: string): string {
  return branch === 'master' ? 'master' : 'main';
}
