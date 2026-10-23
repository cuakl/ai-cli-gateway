import { useEffect, useState } from 'preact/hooks';
import type { GitCommitRequest, GitDiffFile, GitDiffHunk, GitDiffSummary } from '@aidev/protocol';

export interface DiffViewerProps {
  summary: GitDiffSummary | null;
  loading: boolean;
  error: string | null;
  onCommit: (request: GitCommitRequest) => Promise<{ commitHash: string; branch: string }>;
  onDiscard: (files?: string[]) => Promise<void>;
  onClose: () => void;
}

export function DiffViewer({ summary, loading, error, onCommit, onDiscard, onClose }: DiffViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const files = summary?.files ?? [];
  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  useEffect(() => {
    setSelectedPath((current) => {
      if (files.length === 0) return null;
      if (current && files.some((file) => file.path === current)) return current;
      return files[0]?.path ?? null;
    });
  }, [summary]);

  async function commit(): Promise<void> {
    const text = message.trim();
    if (!text || busy || files.length === 0) return;
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      const result = await onCommit({
        message: text,
        push,
        files: files.map((file) => file.path),
      });
      setMessage('');
      setStatus(
        push
          ? `Committed ${shortHash(result.commitHash)} and pushed ${result.branch}.`
          : `Committed ${shortHash(result.commitHash)} on ${result.branch}.`,
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
  }

  async function discard(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      await onDiscard(files.map((file) => file.path));
      setConfirming(false);
      setStatus('Discarded uncommitted changes.');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Discard failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="drawer wide" aria-label="Diffs">
      <header className="drawer-header">
        <div className="header-copy">
          <p className="kicker">{summary?.branch ?? 'Working tree'}</p>
          <h2>Diffs</h2>
        </div>
        <button type="button" className="icon-button" data-action="close-diffs" onClick={onClose}>
          ✕
        </button>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      {actionError ? <p className="banner">{actionError}</p> : null}
      {status ? <p className="banner ok">{status}</p> : null}
      {loading && files.length === 0 ? <p className="empty">Loading diff…</p> : null}
      {!loading && files.length === 0 ? <p className="empty">No uncommitted changes.</p> : null}
      {files.length > 0 ? (
        <div className="diff-layout">
          <div className="file-list" role="listbox" aria-label="Modified files">
            {files.map((file) => (
              <button
                key={file.path}
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
            ))}
          </div>
          <div className="diff-view">{selected ? <FileDiff file={selected} /> : null}</div>
        </div>
      ) : null}
      <form
        className="commit-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          aria-label="Commit message"
          placeholder="Commit message"
          value={message}
          disabled={busy}
          onInput={(event) => setMessage(event.currentTarget.value)}
        />
        <label className="push-toggle">
          <input
            type="checkbox"
            checked={push}
            disabled={busy}
            onChange={(event) => setPush(event.currentTarget.checked)}
          />
          Push to origin
        </label>
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
                  void discard();
                }}
              >
                Discard changes
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ghost"
              data-action="discard"
              disabled={busy || files.length === 0}
              onClick={() => setConfirming(true)}
            >
              Discard
            </button>
          )}
          <button type="submit" className="primary" data-action="commit" disabled={busy || message.trim().length === 0 || files.length === 0}>
            Commit Changes
          </button>
        </div>
      </form>
    </section>
  );
}

function FileDiff({ file }: { file: GitDiffFile }) {
  return (
    <div className="diff-file">
      <div className="diff-file-head">
        <span className="file-status">{file.status}</span>
        <span className="file-sep" aria-hidden="true">·</span>
        <span className="file-path" title={file.path}>
          {file.path}
        </span>
      </div>
      {file.binary ? <p className="empty">Binary file.</p> : null}
      {(file.hunks ?? []).map((hunk, index) => (
        <HunkView key={`${hunk.oldStart}-${hunk.newStart}-${index}`} hunk={hunk} />
      ))}
    </div>
  );
}

function HunkView({ hunk }: { hunk: GitDiffHunk }) {
  const lines = hunk.content === '' ? [] : hunk.content.split('\n');
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return (
    <div className="hunk">
      <div className="hunk-header">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      {lines.map((line, index) => {
        const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('\\') ? 'meta' : 'ctx';
        const showOld = kind === 'add' || kind === 'meta' ? '' : String(oldLine);
        const showNew = kind === 'del' || kind === 'meta' ? '' : String(newLine);
        if (kind !== 'add' && kind !== 'meta') oldLine += 1;
        if (kind !== 'del' && kind !== 'meta') newLine += 1;
        return (
          <div key={index} className={`diff-line diff-${kind}`}>
            <span className="ln">{showOld}</span>
            <span className="ln">{showNew}</span>
            <code>{line || ' '}</code>
          </div>
        );
      })}
    </div>
  );
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}
