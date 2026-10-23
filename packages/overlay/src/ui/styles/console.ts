export const CONSOLE_CSS = `
.console-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  padding: var(--aid-space-2) var(--aid-space-3);
  border-bottom: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.console-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.console-filters button {
  min-height: 28px;
  padding: var(--aid-space-1) var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 560;
}

.console-filters button:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.console-filters button[aria-pressed="true"] {
  background: var(--aid-bg-hover);
  color: var(--aid-text);
}

.console-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.console-row {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-1);
  padding: var(--aid-space-2) var(--aid-space-3);
  border-bottom: 1px solid var(--aid-border);
}

.console-row[data-kind="error"],
.console-row[data-kind="vite"],
.console-row[data-kind="network"] { border-left: 2px solid var(--aid-danger); }

.console-row[data-kind="warn"] { border-left: 2px solid var(--aid-warning); }

.console-main {
  display: flex;
  align-items: baseline;
  gap: var(--aid-space-2);
  min-width: 0;
}

.console-time {
  flex: none;
  color: var(--aid-text-muted);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
}

.console-message {
  min-width: 0;
  color: var(--aid-text);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.console-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--aid-space-2);
  padding-left: calc(var(--aid-space-2) + 7ch);
}

.console-source {
  padding: 0;
  color: var(--aid-accent);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.console-source:hover { color: var(--aid-text); }

.console-stack {
  margin: 0;
  padding: var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg);
  color: var(--aid-text-muted);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.console-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-1);
}

.count[data-tone="danger"] {
  background: color-mix(in srgb, var(--aid-danger) 22%, var(--aid-bg));
  color: var(--aid-danger);
}
`;
