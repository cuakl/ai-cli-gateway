export const TOOLBAR_CSS = `
.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: var(--aid-z-dock);
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 2px;
  max-width: calc(100vw - 32px);
  padding: 6px;
  overflow-x: auto;
  pointer-events: auto;
  background: var(--aid-bg-raised);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-lg);
  box-shadow: var(--aid-shadow-lg);
  backdrop-filter: blur(16px);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-2);
  margin-right: var(--aid-space-1);
  padding: 0 10px 0 var(--aid-space-2);
  color: var(--aid-text);
  font-weight: 620;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.brand-mark {
  width: 14px;
  height: 14px;
  border-radius: var(--aid-radius-sm);
  background: linear-gradient(160deg, var(--aid-accent) 0%, var(--aid-accent) 55%, var(--aid-bg) 100%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aid-accent-fg) 28%, transparent);
}

.status {
  width: var(--aid-space-2);
  height: var(--aid-space-2);
  border-radius: var(--aid-radius-full);
  background: var(--aid-text-muted);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--aid-text-muted) 18%, transparent);
}

.status[data-state="connected"] {
  background: var(--aid-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--aid-success) 22%, transparent);
}

.toolbar button {
  min-height: 32px;
  padding: 6px var(--aid-space-3);
  border-radius: var(--aid-radius-full);
  color: var(--aid-text-muted);
  white-space: nowrap;
}

.toolbar button:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.toolbar button[aria-pressed="true"] {
  background: var(--aid-accent-solid);
  color: var(--aid-accent-fg);
}

.count {
  display: inline-block;
  margin-left: 6px;
  min-width: 1.2em;
  padding: 0 6px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  line-height: 1.6;
  text-align: center;
}

.toolbar button[aria-pressed="true"] .count {
  background: color-mix(in srgb, var(--aid-accent-fg) 18%, transparent);
  color: var(--aid-accent-fg);
}
`;
