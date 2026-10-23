export const DIFF_CSS = `
.diff-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.file-list {
  width: 230px;
  overflow: auto;
  border-right: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.file-list button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px var(--aid-space-3);
  border-radius: 0;
  text-align: left;
  color: var(--aid-text);
  font-family: var(--aid-font);
}

.file-list button[aria-selected="true"] { background: var(--aid-bg-hover); }
.file-list button:hover { background: var(--aid-bg-hover); }

.file-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 560;
}

.file-stats {
  display: inline-flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: var(--aid-space-2);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  white-space: nowrap;
}
.stat-add { color: var(--aid-success); }
.stat-del { color: var(--aid-danger); }

.diff-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--aid-bg);
  color: var(--aid-text);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  line-height: 1.55;
}

.diff-file {
  min-width: 0;
}

.diff-file-head, .hunk-header {
  padding: var(--aid-space-2) var(--aid-space-3);
  color: var(--aid-text-muted);
  font-family: var(--aid-mono);
}

.diff-file-head {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  border-bottom: 1px solid var(--aid-border);
}

.file-status {
  flex: none;
  padding: 2px 7px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.file-sep {
  flex: none;
  color: var(--aid-text-muted);
}

.file-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hunk {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.diff-line {
  display: grid;
  grid-template-columns: 4ch 4ch max-content;
  column-gap: 1.25ch;
  width: max-content;
  min-width: 100%;
  white-space: pre;
}

.diff-line code {
  padding-right: var(--aid-space-3);
  color: var(--aid-text);
  font-family: var(--aid-mono);
  white-space: pre;
}

.diff-add { background: var(--aid-add-bg); }
.diff-add code { color: var(--aid-success); }
.diff-del { background: var(--aid-del-bg); }
.diff-del code { color: var(--aid-danger); }
.diff-meta { color: var(--aid-text-muted); }

.ln {
  width: 4ch;
  min-width: 4ch;
  padding: 0;
  color: var(--aid-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.commit-bar {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  padding: var(--aid-space-3) 14px;
  border-top: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.commit-bar input[type="text"], .commit-bar input:not([type]) {
  width: 100%;
  padding: 9px var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  border: 1px solid var(--aid-border);
  background: var(--aid-bg);
  color: var(--aid-text);
  outline: none;
}

.commit-bar input::placeholder { color: var(--aid-text-muted); }

.push-toggle, .confirm {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  color: var(--aid-text);
}
`;
