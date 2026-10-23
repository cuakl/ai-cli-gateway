export const DIFF_CSS = `
.review-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  padding: var(--aid-space-2) var(--aid-space-3);
  border-bottom: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.review-scopes, .review-views {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--aid-radius-md);
  background: var(--aid-bg-hover);
}

.review-scopes button, .review-views button {
  min-height: 28px;
  padding: 4px 10px;
  border-radius: var(--aid-radius-sm);
  color: var(--aid-text-muted);
  font-weight: 600;
}

.review-scopes button[aria-pressed="true"],
.review-views button[aria-pressed="true"] {
  background: var(--aid-bg-raised);
  color: var(--aid-text);
}

.diff-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.file-list {
  width: calc(var(--aid-space-6) * 7);
  overflow: auto;
  border-right: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.file-row {
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.file-check {
  display: flex;
  align-items: center;
  padding-left: var(--aid-space-2);
}

.file-row button {
  flex: 1;
  width: auto;
  min-width: 0;
}

.sheet .diff-layout {
  flex-direction: column;
}

.sheet .file-list {
  width: auto;
  max-height: calc(var(--aid-space-6) * 4);
  flex: none;
  border-right: 0;
  border-bottom: 1px solid var(--aid-border);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  padding: var(--aid-space-2) var(--aid-space-3);
  color: var(--aid-text-muted);
  font-family: var(--aid-mono);
}

.hunk-header button {
  flex: none;
  min-height: 28px;
  padding: 4px 10px;
}

.hunk-active .hunk-header {
  background: var(--aid-bg-hover);
}

.diff-file-head {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  border-bottom: 1px solid var(--aid-border);
}

.diff-file-head button {
  margin-left: auto;
  flex: none;
  min-height: 28px;
  padding: 4px 10px;
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

.diff-split-line, .diff-empty {
  grid-template-columns: 4ch max-content;
}

.diff-line code {
  padding-right: var(--aid-space-3);
  color: var(--aid-text);
  font-family: var(--aid-mono);
  white-space: pre;
}

.diff-marker { user-select: none; }
.diff-add { background: var(--aid-add-bg); }
.diff-add .diff-marker { color: var(--aid-success); }
.diff-del { background: var(--aid-del-bg); }
.diff-del .diff-marker { color: var(--aid-danger); }
.diff-meta { color: var(--aid-text-muted); }
.diff-empty { background: var(--aid-bg-hover); }

.diff-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-width: 0;
}

.diff-split-pane {
  min-width: 0;
  overflow-x: auto;
}

.diff-split-pane + .diff-split-pane {
  border-left: 1px solid var(--aid-border);
}

.tok-keyword { color: var(--aid-accent); }
.tok-string { color: var(--aid-success); }
.tok-comment { color: var(--aid-text-muted); }
.tok-number { color: var(--aid-warning); }
.tok-tag { color: var(--aid-accent); }

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

.commit-bar input[type="text"], .commit-bar input:not([type]), .commit-bar textarea {
  width: 100%;
  padding: 9px var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  border: 1px solid var(--aid-border);
  background: var(--aid-bg);
  color: var(--aid-text);
  outline: none;
  resize: vertical;
}

.commit-bar input::placeholder, .commit-bar textarea::placeholder { color: var(--aid-text-muted); }

.commit-message-row {
  display: flex;
  align-items: flex-start;
  gap: var(--aid-space-2);
}

.commit-message-row textarea { flex: 1; min-width: 0; }
.commit-message-row button {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-1);
  flex: none;
}

.commit-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--aid-space-2);
}

.branch-indicator {
  color: var(--aid-text);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
}

.branch-create {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-2);
  min-width: 0;
}

.branch-create input { width: 16ch; }

.push-toggle, .confirm {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  color: var(--aid-text);
}

.commit-log {
  padding: var(--aid-space-3) 14px;
  border-top: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.commit-log ol {
  margin: var(--aid-space-2) 0;
  padding: 0;
  list-style: none;
}

.commit-log li {
  display: flex;
  align-items: baseline;
  gap: var(--aid-space-2);
  color: var(--aid-text);
  font-size: var(--aid-text-sm);
}

.commit-log code { color: var(--aid-text-muted); }
`;
