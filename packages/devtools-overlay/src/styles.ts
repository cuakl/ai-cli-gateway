/** Shared with the host inline style. `all: initial` would otherwise leave a serif and black text. */
export const OVERLAY_FONT =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const OVERLAY_MONO =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

export const OVERLAY_TEXT = '#f5f7fb';

/** Injected into the shadow root so host-page CSS cannot restyle the overlay. */
export const OVERLAY_CSS = `
:host {
  color-scheme: dark;
  font-family: ${OVERLAY_FONT};
  font-size: 13px;
  line-height: 1.45;
  font-weight: 450;
  letter-spacing: -0.011em;
  color: ${OVERLAY_TEXT};
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

*, *::before, *::after { box-sizing: border-box; }

#ai-devtools-root,
.dock {
  font-family: ${OVERLAY_FONT};
  color: ${OVERLAY_TEXT};
  letter-spacing: -0.011em;
  -webkit-font-smoothing: antialiased;
}

#ai-devtools-root { pointer-events: none; }

button, textarea, select, input {
  font-family: ${OVERLAY_FONT};
  font-size: 13px;
  line-height: 1.45;
  letter-spacing: -0.011em;
  color: ${OVERLAY_TEXT};
  color-scheme: dark;
}

button, textarea, select { font-weight: 500; }

h2, p, span, label, code, pre { color: inherit; }

.inspect-banner {
  position: fixed;
  top: 18px;
  left: 50%;
  z-index: 2147483647;
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: 8px 14px;
  pointer-events: none;
  background: #221c3d;
  color: #f4f1ff;
  border: 1px solid rgba(167, 139, 250, 0.55);
  border-radius: 999px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  font-weight: 560;
}

.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 2px;
  max-width: calc(100vw - 32px);
  padding: 6px;
  overflow-x: auto;
  pointer-events: auto;
  background: rgba(18, 20, 27, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 4px;
  padding: 0 10px 0 8px;
  color: #f7f8fb;
  font-weight: 620;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.brand-mark {
  width: 14px;
  height: 14px;
  border-radius: 5px;
  background: linear-gradient(160deg, #c4b5fd 0%, #6d5efc 55%, #312e81 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}

.status {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #8b93a7;
  box-shadow: 0 0 0 3px rgba(139, 147, 167, 0.18);
}

.status[data-state="connected"] {
  background: #3dd68c;
  box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.22);
}

.toolbar button,
.drawer button,
.suggestions button,
.notice button {
  border: 0;
  background: transparent;
  cursor: pointer;
}

.toolbar button {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 999px;
  color: #d5dbe8;
  white-space: nowrap;
}

.toolbar button:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }

.toolbar button[aria-pressed="true"] {
  background: #6d5efc;
  color: #fff;
}

.toolbar button:focus-visible,
.drawer button:focus-visible,
.composer textarea:focus-visible,
.provider:focus-visible,
.commit-bar input:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}

.drawer {
  position: fixed;
  right: 16px;
  bottom: 76px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 108px));
  pointer-events: auto;
  overflow: hidden;
  background: #14161d;
  color: ${OVERLAY_TEXT};
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.drawer.wide { width: min(880px, calc(100vw - 32px)); }

.drawer-header,
.composer,
.chip-row,
.suggestions,
.hint { padding-left: 14px; padding-right: 14px; }

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.header-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.kicker {
  margin: 0;
  color: #b7b0e8;
  font-size: 11px;
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.drawer-header h2 {
  margin: 0;
  color: #f7f8fb;
  font-size: 16px;
  font-weight: 620;
  letter-spacing: -0.03em;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: #d5dbe8;
}

.icon-button:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }

.chip-row { padding-top: 10px; padding-bottom: 4px; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 4px 4px 10px;
  border-radius: 999px;
  background: #2a2448;
  color: #ebe6ff;
  font-size: 12px;
  font-weight: 560;
}

.chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages {
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  margin: auto 0;
  padding: 8px 4px 16px;
}

.empty-title {
  margin: 0 0 6px;
  color: #f7f8fb;
  font-size: 15px;
  font-weight: 620;
  letter-spacing: -0.03em;
}

.empty-copy {
  margin: 0;
  max-width: 36em;
  color: #c5ccda;
  font-size: 13px;
  line-height: 1.5;
}

.message {
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  color: #f5f7fb;
  white-space: pre-wrap;
  word-break: break-word;
}

.message.user {
  align-self: flex-end;
  background: #343b52;
  border-bottom-right-radius: 6px;
}

.message.assistant {
  align-self: flex-start;
  background: #1c202a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 6px;
}

.message.pending { color: #d5dbe8; }

.message.error {
  background: #2a1719;
  border-color: rgba(255, 177, 172, 0.45);
  color: #ffe8e6;
}

.activity {
  align-self: flex-start;
  padding: 2px 2px 2px 10px;
  border-left: 2px solid #6d5efc;
  color: #c5ccda;
  font-size: 12px;
  font-weight: 560;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 10px;
}

.suggestions button {
  padding: 5px 10px;
  border-radius: 999px;
  background: #222735;
  color: #e6ebf5;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.suggestions button:hover { background: #2c3344; color: #fff; }

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  padding-bottom: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: #12141b;
}

.provider {
  align-self: flex-start;
  max-width: 100%;
  padding: 6px 28px 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0e1016 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23c5ccda' d='M1 1l5 5 5-5'/%3E%3C/svg%3E") no-repeat right 10px center;
  appearance: none;
}

.hint {
  margin: 0;
  color: #f0c7a0;
  font-size: 12px;
  line-height: 1.4;
}

.composer textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0e1016;
  color: #f5f7fb;
  outline: none;
}

.composer textarea::placeholder { color: #9aa3b5; }

.composer textarea:focus { border-color: #8b7cf8; }

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.shortcut {
  margin-right: auto;
  color: #9aa3b5;
  font-size: 12px;
}

.primary, .ghost, .danger {
  min-height: 32px;
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 600;
}

.primary { background: #6d5efc; color: #fff; }
.primary:hover { background: #7d70ff; }
.primary:disabled, .ghost:disabled, .danger:disabled { opacity: 0.45; cursor: default; }
.ghost { background: #2a3142; color: #f5f7fb; }
.ghost:hover { background: #343c51; }

.count {
  display: inline-block;
  margin-left: 6px;
  min-width: 1.2em;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
}

.notice {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(440px, calc(100vw - 32px));
  padding: 10px 10px 10px 14px;
  pointer-events: auto;
  background: #241c40;
  color: #f4f1ff;
  border: 1px solid rgba(167, 139, 250, 0.7);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}

.notice button {
  flex: none;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #efeaff;
  font-weight: 620;
  white-space: nowrap;
}

.muted { color: #b7c0d0; font-weight: 500; }

.banner, .empty {
  margin: 0;
  padding: 10px 14px;
  color: #ffc1bc;
}

.drawer > .empty {
  flex: 1;
  display: flex;
  align-items: center;
}

.banner.ok { color: #b6f3d4; }
.empty { color: #c5ccda; }

.diff-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.file-list {
  width: 230px;
  overflow: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: #10131a;
}

.file-list button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 0;
  text-align: left;
  color: #e6ebf5;
  font-family: ${OVERLAY_FONT};
}

.file-list button[aria-selected="true"] { background: #2a2448; }
.file-list button:hover { background: rgba(255, 255, 255, 0.04); }

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
  gap: 8px;
  font-family: ${OVERLAY_MONO};
  font-size: 11px;
  white-space: nowrap;
}
.stat-add { color: #7df0b8; }
.stat-del { color: #ffb4ae; }

.diff-view {
  flex: 1;
  overflow: auto;
  background: #0e1016;
  color: #e7edf8;
  font-family: ${OVERLAY_MONO};
  font-size: 12px;
  line-height: 1.55;
}

.diff-file-head, .hunk-header {
  padding: 8px 12px;
  color: #b7c0d0;
  font-family: ${OVERLAY_MONO};
}

.diff-file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.file-status {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #c5ccda;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.file-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-line {
  display: grid;
  grid-template-columns: 3.4em 3.4em minmax(0, 1fr);
  min-width: max-content;
}

.diff-line code {
  padding-right: 12px;
  color: #e7edf8;
  font-family: ${OVERLAY_MONO};
}

.diff-add { background: rgba(61, 214, 140, 0.16); }
.diff-add code { color: #d8ffe9; }
.diff-del { background: rgba(255, 99, 99, 0.16); }
.diff-del code { color: #ffe1de; }
.diff-meta { color: #b7c0d0; }

.ln {
  padding: 0 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  color: #8e98ab;
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.commit-bar, .test-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: #12141b;
}

.commit-bar input[type="text"], .commit-bar input:not([type]) {
  width: 100%;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0e1016;
  color: #f5f7fb;
  outline: none;
}

.commit-bar input::placeholder { color: #9aa3b5; }

.push-toggle, .confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #d5dbe8;
}

.danger { background: #9f1239; color: #fff; }
.danger:hover { background: #be123c; }

.badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: #2a3142;
  color: #e6ebf5;
  font-size: 12px;
  font-weight: 620;
}

.badge[data-status="running"] { background: #3a3014; color: #f6d98a; }
.badge[data-status="passed"] { background: #143528; color: #8ef0c0; }
.badge[data-status="failed"] { background: #3f1717; color: #ffc1bc; }

.test-log, .terminal-host { flex: 1; min-height: 0; }

.test-log {
  margin: 0;
  padding: 14px;
  overflow: auto;
  background: #0e1016;
  color: #e7edf8;
  font-family: ${OVERLAY_MONO};
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.terminal-host { padding: 8px 8px 12px; overflow: hidden; background: #0e1016; }
`;
