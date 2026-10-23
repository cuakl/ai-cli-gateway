export const DOCKS_CSS = `
.side-dock,
.bottom-dock {
  position: fixed;
  z-index: var(--aid-z-dock);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  pointer-events: auto;
  overflow: hidden;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  box-shadow: var(--aid-shadow-lg);
}

.side-dock[hidden],
.bottom-dock[hidden],
.panel[hidden] { display: none !important; }

.side-dock {
  top: 0;
  right: 0;
  bottom: 0;
  border-left: 1px solid var(--aid-border);
}

.bottom-dock {
  left: 0;
  right: 0;
  bottom: 0;
  border-top: 1px solid var(--aid-border);
}

.side-dock.sheet,
.bottom-dock.sheet {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: var(--aid-sheet-height);
  padding-bottom: calc(var(--aid-pill-height) + var(--aid-space-5));
  border-left: 0;
  border-top: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-lg) var(--aid-radius-lg) 0 0;
}

.dock-header {
  flex: none;
  border-bottom: 1px solid var(--aid-border);
  background: var(--aid-bg-raised);
}

.sheet-handle {
  width: var(--aid-space-6);
  height: var(--aid-space-1);
  margin: var(--aid-space-2) auto 0;
  border-radius: var(--aid-radius-full);
  background: var(--aid-border);
}

.dock-header-row {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  min-height: 44px;
  padding: var(--aid-space-1) var(--aid-space-2) var(--aid-space-1) var(--aid-space-3);
}

.dock-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.dock-tabs button {
  min-height: 32px;
  padding: var(--aid-space-1) var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  color: var(--aid-text-muted);
  font-weight: 560;
}

.dock-tabs button:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.dock-tabs button[aria-selected="true"] {
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  box-shadow: inset 0 -2px 0 var(--aid-accent);
}

.dock-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.resize-handle {
  position: absolute;
  z-index: 2;
  background: transparent;
}

.resize-handle:hover,
.resize-handle:focus-visible {
  background: color-mix(in srgb, var(--aid-accent) 45%, transparent);
}

.resize-side {
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--aid-space-2);
  cursor: ew-resize;
}

.resize-bottom {
  top: 0;
  left: 0;
  right: 0;
  height: var(--aid-space-2);
  cursor: ns-resize;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--aid-space-2);
  flex: 1;
  width: 100%;
  min-height: 0;
  margin: auto;
  padding: var(--aid-space-5) var(--aid-space-4);
  text-align: center;
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--aid-space-6) + var(--aid-space-4));
  height: calc(var(--aid-space-6) + var(--aid-space-4));
  border-radius: var(--aid-radius-lg);
  background: var(--aid-bg-hover);
  color: var(--aid-text-muted);
}

.empty-title {
  margin: 0;
  color: var(--aid-text);
  font-size: var(--aid-text-lg);
  font-weight: 620;
  letter-spacing: -0.03em;
}

.empty-copy {
  margin: 0;
  max-width: 28em;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-md);
  line-height: var(--aid-line);
}
`;
