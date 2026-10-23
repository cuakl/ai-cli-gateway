import type { AssistantItem, ChangedFile } from './model.js';

export interface RunFooterProps {
  item: AssistantItem;
  onReview: () => void;
  onUndo: (runId: string) => void;
  onKeepGoing: () => void;
}

export function RunFooter({ item, onReview, onUndo, onKeepGoing }: RunFooterProps) {
  const files = filesOf(item);
  const finished = item.status !== 'running' && item.status !== 'queued';
  const summary = [
    statusLabel(item.status),
    item.durationMs != null ? formatDuration(item.durationMs) : null,
    item.model ?? null,
    files.length > 0 ? filesSummary(files) : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="run-footer">
      <p className="run-footer-meta">{summary.join(' · ')}</p>
      {finished ? (
        <div className="run-footer-actions">
          {files.length > 0 ? (
            <>
              <button type="button" className="ghost" data-action="run-review" onClick={onReview}>
                Review
              </button>
              <button type="button" className="ghost" data-action="run-undo" onClick={() => onUndo(item.runId)}>
                Undo
              </button>
            </>
          ) : null}
          <button type="button" className="ghost" data-action="run-keep-going" onClick={onKeepGoing}>
            Keep going
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function filesOf(item: AssistantItem): ChangedFile[] {
  const block = [...item.blocks].reverse().find((entry) => entry.kind === 'files');
  return block?.kind === 'files' ? block.files : [];
}

export function filesSummary(files: readonly ChangedFile[]): string {
  const count = files.length;
  const noun = count === 1 ? 'file' : 'files';
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  if (additions === 0 && deletions === 0) return `${count} ${noun} changed`;
  return `${count} ${noun} changed +${additions} −${deletions}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function statusLabel(status: AssistantItem['status']): string {
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  if (status === 'succeeded' || status === 'done') return 'Done';
  if (status === 'failed' || status === 'error') return 'Failed';
  if (status === 'cancelled') return 'Stopped';
  if (status === 'timeout') return 'Timed out';
  return status;
}
