import type { ProviderType, Thread } from '@aidev/protocol';
import { EmptyState } from '../EmptyState.js';
import { FileTextIcon } from '../icons.js';
import { providerLabel } from './Composer.js';

export interface HistoryRow {
  thread: Thread;
  runCount: number;
}

export interface HistoryListProps {
  rows: HistoryRow[];
  loading: boolean;
  error: string | null;
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}

export function HistoryList({ rows, loading, error, activeThreadId, onSelect }: HistoryListProps) {
  if (loading && rows.length === 0) {
    return (
      <div className="history-list" data-action="history-list">
        <p className="hint">Loading chats…</p>
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="history-list" data-action="history-list">
        <p className="hint" title={error}>
          {error}
        </p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon size={24} />}
        title="No previous chats"
        hint="Send a prompt to start a thread. It will show up here so you can resume it later."
      />
    );
  }
  return (
    <ul className="history-list" data-action="history-list">
      {rows.map((row) => (
        <li key={row.thread.id}>
          <button
            type="button"
            className="history-item"
            data-action="history-item"
            data-thread-id={row.thread.id}
            aria-current={row.thread.id === activeThreadId ? 'true' : undefined}
            onClick={() => onSelect(row.thread.id)}
          >
            <span className="history-title">{row.thread.title || 'Untitled chat'}</span>
            <span className="history-meta">
              {providerLabel(row.thread.provider as ProviderType)}
              {' · '}
              {relativeTime(row.thread.updatedAt)}
              {' · '}
              {row.runCount === 1 ? '1 run' : `${row.runCount} runs`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const seconds = Math.round(delta / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}
