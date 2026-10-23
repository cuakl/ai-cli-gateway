export const TESTS_CSS = `
.badge {
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
  flex-direction: column;
  gap: var(--aid-space-2);
  padding: var(--aid-space-3) 14px;
  border-top: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.test-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
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
`;
