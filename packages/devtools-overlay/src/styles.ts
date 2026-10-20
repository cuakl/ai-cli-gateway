/** Injected into the shadow root so host-page CSS cannot restyle the overlay. */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #e7e9ee;
}

*, *::before, *::after { box-sizing: border-box; }

#ai-devtools-root {
  pointer-events: none;
}

button, textarea, select {
  font: inherit;
  color: inherit;
}

.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  pointer-events: auto;
  background: #111318;
  border: 1px solid #2c313c;
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 6px;
  color: #f4f6fb;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.status {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #6b7280;
  box-shadow: 0 0 0 3px rgba(107, 114, 128, 0.25);
}

.status[data-state="connected"] {
  background: #3dd68c;
  box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.2);
}

.toolbar button,
.drawer button,
.suggestions button {
  border: 0;
  background: transparent;
  cursor: pointer;
}

.toolbar button {
  padding: 6px 12px;
  border-radius: 999px;
  color: #d5d9e2;
}

.toolbar button:hover,
.toolbar button[aria-pressed="true"] {
  background: #7c5cff;
  color: white;
}

.drawer {
  position: fixed;
  right: 16px;
  bottom: 72px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - 32px));
  height: min(520px, calc(100vh - 110px));
  pointer-events: auto;
  overflow: hidden;
  background: #171a21;
  border: 1px solid #2c313c;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.drawer-header,
.composer,
.chip-row,
.suggestions {
  padding-left: 12px;
  padding-right: 12px;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  padding-bottom: 8px;
}

.drawer-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: #c5cad3;
}

.icon-button:hover { background: #2a2f3a; }

.chip-row { padding-bottom: 8px; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 6px 4px 8px;
  border-radius: 999px;
  background: #241c40;
  color: #ddd6fe;
  font-size: 12px;
}

.chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages {
  flex: 1;
  overflow: auto;
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  max-width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.message.user {
  align-self: flex-end;
  background: #2a3142;
}

.message.assistant {
  align-self: flex-start;
  background: #12151c;
  border: 1px solid #2c313c;
}

.message.pending { color: #9aa3b2; }

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
}

.suggestions button {
  padding: 4px 8px;
  border-radius: 999px;
  background: #222733;
  color: #d5d9e2;
}

.suggestions button:hover { background: #2e3544; }

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  padding-bottom: 12px;
  border-top: 1px solid #2c313c;
}

.provider {
  align-self: flex-start;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid #2c313c;
  background: #101319;
}

.composer textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #2c313c;
  background: #101319;
  outline: none;
}

.composer textarea:focus { border-color: #7c5cff; }

.composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.primary, .ghost {
  padding: 6px 12px;
  border-radius: 999px;
}

.primary {
  background: #7c5cff;
  color: white;
}

.primary:disabled, .ghost:disabled {
  opacity: 0.5;
  cursor: default;
}

.ghost { background: #2a2f3a; }
`;
