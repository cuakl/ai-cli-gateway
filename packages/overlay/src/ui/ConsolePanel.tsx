import { useState } from 'preact/hooks';
import {
  filterConsoleEntries,
  listConsoleEntries,
  type ConsoleEntry,
  type ConsoleFilter,
} from '../context/entries.js';
import { EmptyState } from './EmptyState.js';
import { ConsoleIcon } from './icons.js';
import type { WorkspaceConnection } from './workspace-client.js';

export interface ConsolePanelProps {
  workspace: WorkspaceConnection;
  onFix: (entry: ConsoleEntry) => void;
}

const FILTERS: Array<{ id: ConsoleFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'network', label: 'Network' },
  { id: 'vite', label: 'Vite' },
];

export function ConsolePanel({ workspace, onFix }: ConsolePanelProps) {
  const [filter, setFilter] = useState<ConsoleFilter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const entries = filterConsoleEntries(listConsoleEntries(), filter);

  return (
    <section className="panel" aria-label="Console">
      <div className="console-toolbar">
        <p className="kicker">Console</p>
        <div className="console-filters" role="toolbar" aria-label="Console filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-action={`console-filter-${item.id}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={<ConsoleIcon />}
          title="No console entries"
          hint="Errors, warnings, failed requests, and Vite compile errors show up here."
        />
      ) : (
        <ul className="console-list">
          {entries.map((entry) => {
            const open = Boolean(expanded[entry.id]);
            return (
              <li key={entry.id} className="console-row" data-kind={entry.filter} data-entry={entry.id}>
                <div className="console-main">
                  <span className="console-time">{formatTime(entry.timestamp)}</span>
                  <span className="console-message">{entry.message}</span>
                </div>
                <div className="console-meta">
                  {entry.source ? (
                    <button
                      type="button"
                      className="console-source"
                      data-action="open-source"
                      title={`Open ${entry.source.file}`}
                      onClick={() => {
                        void workspace.request({
                          type: 'editor.open',
                          file: entry.source!.file,
                          ...(entry.source!.line != null ? { line: entry.source!.line } : {}),
                          ...(entry.source!.column != null ? { column: entry.source!.column } : {}),
                        });
                      }}
                    >
                      {sourceLabel(entry.source)}
                    </button>
                  ) : null}
                  {entry.stack ? (
                    <button
                      type="button"
                      className="ghost"
                      data-action="toggle-stack"
                      aria-expanded={open}
                      onClick={() => setExpanded((current) => ({ ...current, [entry.id]: !current[entry.id] }))}
                    >
                      {open ? 'Hide stack' : 'Show stack'}
                    </button>
                  ) : null}
                  {entry.fixable ? (
                    <button
                      type="button"
                      className="ghost"
                      data-action="fix-with-ai"
                      onClick={() => onFix(entry)}
                    >
                      Fix with AI
                    </button>
                  ) : null}
                </div>
                {open && entry.stack ? <pre className="console-stack">{entry.stack}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(timestamp);
  }
}

function sourceLabel(source: NonNullable<ConsoleEntry['source']>): string {
  const file = source.file.split(/[/\\]/).pop() ?? source.file;
  return source.line != null ? `${file}:${source.line}` : file;
}
