export const TESTS_CSS = `
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-1);
  padding: 3px var(--aid-space-2);
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  font-weight: 620;
}

.badge[data-status="running"] { background: color-mix(in srgb, var(--aid-warning) 22%, var(--aid-bg)); color: var(--aid-warning); }
.badge[data-status="passed"] { background: color-mix(in srgb, var(--aid-success) 22%, var(--aid-bg)); color: var(--aid-success); }
.badge[data-status="failed"] { background: color-mix(in srgb, var(--aid-danger) 22%, var(--aid-bg)); color: var(--aid-danger); }
.badge[data-status="stopped"] { background: var(--aid-bg-hover); color: var(--aid-text); }

.test-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  padding: var(--aid-space-3) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.test-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--aid-space-2);
}

.test-actions .primary,
.test-actions .ghost {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-1);
}

.test-settings {
  display: flex;
  align-items: center;
  padding: var(--aid-space-2) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
}

.test-auto-run {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-2);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
}

.test-summary {
  margin: 0;
  padding: var(--aid-space-2) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  font-variant-numeric: tabular-nums;
}

.test-log {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 14px;
  overflow: auto;
  background: var(--aid-bg);
  color: var(--aid-text);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  line-height: 1.55;
  white-space: pre-wrap;
}

.test-tree,
.test-cases {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.test-cases {
  flex: none;
  padding: 0 0 var(--aid-space-2) var(--aid-space-4);
}

.test-file,
.test-case {
  border-bottom: 1px solid var(--aid-border);
}

.test-case { border-bottom-color: color-mix(in srgb, var(--aid-border) 70%, transparent); }

.test-file[data-status="failed"],
.test-case[data-status="failed"] { color: var(--aid-danger); }

.test-file[data-status="passed"],
.test-case[data-status="passed"] { color: var(--aid-text); }

.test-file[data-status="skipped"],
.test-case[data-status="skipped"] { color: var(--aid-text-muted); }

.test-file-row,
.test-node {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  width: 100%;
  min-height: 32px;
  padding: var(--aid-space-1) var(--aid-space-4);
  text-align: left;
}

.test-file-row { padding-right: var(--aid-space-2); }

.test-node {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.test-node:hover { background: var(--aid-bg-hover); }

.test-node-status {
  flex: none;
  color: inherit;
  font-size: var(--aid-text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.test-node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
}

.test-failure {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  padding: 0 var(--aid-space-4) var(--aid-space-3) calc(var(--aid-space-4) + 2ch);
}

.test-diff {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
}

.test-diff-side {
  min-width: 0;
  padding: var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
}

.test-diff-side[data-side="expected"] { background: var(--aid-del-bg); }
.test-diff-side[data-side="received"] { background: var(--aid-add-bg); }

.test-diff-label {
  margin: 0 0 var(--aid-space-1);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
}

.test-diff-value,
.test-failure-message {
  margin: 0;
  color: var(--aid-text);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.test-failure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
}
`;
