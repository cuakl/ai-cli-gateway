export const BASE_CSS = `
:host {
  color-scheme: dark;
  font-family: var(--aid-font);
  font-size: var(--aid-text-md);
  line-height: var(--aid-line);
  font-weight: 450;
  letter-spacing: -0.011em;
  color: var(--aid-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

:host([data-theme='light']) { color-scheme: light; }
:host([data-theme='system']) { color-scheme: light dark; }

:host * { font-family: var(--aid-font); }

*, *::before, *::after { box-sizing: border-box; }

#ai-devtools-root,
.dock {
  font-family: var(--aid-font);
  color: var(--aid-text);
  letter-spacing: -0.011em;
  -webkit-font-smoothing: antialiased;
}

#ai-devtools-root { pointer-events: none; }

button, textarea, select, input {
  font-family: var(--aid-font);
  font-size: var(--aid-text-md);
  line-height: var(--aid-line);
  letter-spacing: -0.011em;
  color: var(--aid-text);
}

button, textarea, select { font-weight: 500; }

h2, p, span, label, code, pre { color: inherit; }

code, pre { font-family: var(--aid-mono); }

.toolbar button,
.drawer button,
.suggestions button,
.notice button {
  border: 0;
  background: transparent;
  cursor: pointer;
}

:host :is(button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--aid-accent);
  outline-offset: 2px;
}

.drawer {
  position: fixed;
  right: 16px;
  bottom: 76px;
  z-index: var(--aid-z-dock);
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 108px));
  min-width: 0;
  pointer-events: auto;
  overflow: hidden;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-lg);
  box-shadow: var(--aid-shadow-lg);
}

.drawer.wide { width: min(880px, calc(100vw - 32px)); }

.drawer[hidden] { display: none; }

.drawer-header,
.composer,
.chip-row,
.suggestions,
.hint { padding-left: 14px; padding-right: 14px; }

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-3);
  padding-top: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--aid-border);
}

.header-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.kicker {
  margin: 0;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.drawer-header h2 {
  margin: 0;
  color: var(--aid-text);
  font-size: var(--aid-text-lg);
  font-weight: 620;
  letter-spacing: -0.03em;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--aid-radius-sm);
  color: var(--aid-text-muted);
}

.icon-button:hover { background: var(--aid-bg-hover); color: var(--aid-text); }

.primary, .ghost, .danger {
  min-height: 32px;
  padding: 6px 14px;
  border-radius: var(--aid-radius-full);
  font-weight: 600;
}

.primary { background: var(--aid-accent-solid); color: var(--aid-accent-fg); }
.primary:hover { filter: brightness(1.08); }
.primary:disabled, .ghost:disabled, .danger:disabled { opacity: 0.45; cursor: default; }
.ghost { background: var(--aid-bg-hover); color: var(--aid-text); }
.ghost:hover { filter: brightness(1.08); }

.danger { background: var(--aid-danger-solid); color: var(--aid-accent-fg); }
.danger:hover { filter: brightness(1.08); }

.muted { color: var(--aid-text-muted); font-weight: 500; }

.banner, .empty {
  margin: 0;
  padding: 10px 14px;
  color: var(--aid-danger);
}

.drawer > .empty {
  flex: 1;
  display: flex;
  align-items: center;
}

.banner.ok { color: var(--aid-success); }
.empty { color: var(--aid-text-muted); }

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--aid-space-2);
}

@keyframes aid-spin {
  to { transform: rotate(360deg); }
}

.aid-icon-spin {
  animation: aid-spin var(--aid-dur-spin) linear infinite;
}
`;
