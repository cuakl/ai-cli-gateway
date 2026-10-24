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

.pill button,
.side-dock button,
.bottom-dock button,
.suggestions button,
.notice button,
.toast button,
.palette-item {
  border: 0;
  background: transparent;
  cursor: pointer;
}

:host :is(button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--aid-accent);
  outline-offset: 2px;
}

.composer,
.chip-row,
.suggestions,
.hint { padding-left: var(--aid-space-4); padding-right: var(--aid-space-4); }

.kicker {
  margin: 0;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: var(--aid-radius-sm);
  color: var(--aid-text-muted);
  cursor: pointer;
}

.icon-button svg {
  display: block;
  flex: none;
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
  padding: 10px var(--aid-space-4);
  color: var(--aid-danger);
}

.panel > .empty {
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
