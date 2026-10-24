export const TERMINAL_CSS = `
.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  padding: var(--aid-space-2) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.terminal-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--aid-space-2);
}

.terminal-fallback {
  margin: 0;
  padding: var(--aid-space-1) var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
  background: color-mix(in srgb, var(--aid-warning) 16%, var(--aid-bg));
  color: var(--aid-warning);
  font-size: var(--aid-text-xs);
}

.terminal-cwd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--aid-mono);
}

.terminal-host {
  flex: 1;
  min-height: 0;
  padding: var(--aid-space-2) var(--aid-space-2) var(--aid-space-3);
  overflow: hidden;
  background: var(--aid-bg);
  font-family: var(--aid-mono);
  letter-spacing: 0;
}

.terminal-host,
.terminal-host * {
  font-family: var(--aid-mono);
  letter-spacing: 0;
}
`;
