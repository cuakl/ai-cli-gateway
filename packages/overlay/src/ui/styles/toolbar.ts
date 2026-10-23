export const TOOLBAR_CSS = `
.pill {
  position: fixed;
  z-index: var(--aid-z-popover);
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--aid-space-1);
  height: var(--aid-pill-height);
  max-width: calc(100vw - var(--aid-space-6));
  padding: var(--aid-space-1);
  pointer-events: auto;
  background: var(--aid-bg-raised);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-full);
  box-shadow: var(--aid-shadow-lg);
  backdrop-filter: blur(16px);
  transition:
    left var(--aid-dur) var(--aid-ease),
    right var(--aid-dur) var(--aid-ease),
    top var(--aid-dur) var(--aid-ease),
    bottom var(--aid-dur) var(--aid-ease);
}

.pill-dragging {
  cursor: grabbing;
  transition: none;
}

.pill-grip {
  flex: none;
  width: 22px;
  height: 28px;
  color: var(--aid-text-muted);
  cursor: grab;
}

.pill-grip:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.brand {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--aid-space-2);
  padding: 0 var(--aid-space-1);
}

.brand-mark {
  width: 14px;
  height: 14px;
  border-radius: var(--aid-radius-sm);
  background: linear-gradient(160deg, var(--aid-accent) 0%, var(--aid-accent) 55%, var(--aid-bg) 100%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aid-accent-fg) 28%, transparent);
}

.status {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--aid-space-2);
  height: var(--aid-space-2);
  border-radius: var(--aid-radius-full);
  background: var(--aid-text-muted);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--aid-text-muted) 18%, transparent);
  color: var(--aid-warning);
}

.status[data-state="connected"] {
  background: var(--aid-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--aid-success) 22%, transparent);
}

.status[data-state="running"] {
  width: var(--aid-space-3);
  height: var(--aid-space-3);
  background: transparent;
  box-shadow: none;
}

.pill button {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--aid-space-1);
  min-height: 32px;
  padding: var(--aid-space-1) var(--aid-space-3);
  border-radius: var(--aid-radius-full);
  color: var(--aid-text-muted);
  white-space: nowrap;
}

.pill button:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.pill button[aria-pressed="true"] {
  background: var(--aid-accent-solid);
  color: var(--aid-accent-fg);
}

.pill-label { font-weight: 560; }

.pill-compact button { padding: var(--aid-space-1); }
.pill-compact .pill-label { display: none; }

.count {
  display: inline-block;
  margin-left: 2px;
  min-width: 1.2em;
  padding: 0 6px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  line-height: 1.6;
  text-align: center;
}

.pill button[aria-pressed="true"] .count {
  background: color-mix(in srgb, var(--aid-accent-fg) 18%, transparent);
  color: var(--aid-accent-fg);
}

.pill-unread {
  position: absolute;
  top: 4px;
  right: 4px;
  width: var(--aid-space-2);
  height: var(--aid-space-2);
  border-radius: var(--aid-radius-full);
  background: var(--aid-accent);
  box-shadow: 0 0 0 2px var(--aid-bg-raised);
}
`;
