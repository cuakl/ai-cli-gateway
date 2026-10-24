export const CHAT_CSS = `
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-1);
  padding-top: 10px;
  padding-bottom: var(--aid-space-1);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--aid-space-1);
  max-width: 100%;
  padding: var(--aid-space-1) var(--aid-space-1) var(--aid-space-1) 10px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  font-weight: 560;
}

.chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-thumb {
  width: 32px;
  height: 20px;
  border-radius: var(--aid-radius-sm);
  object-fit: cover;
  flex: none;
  display: block;
}

.transcript {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow: auto;
  padding: var(--aid-space-3) 14px;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-3);
}

.message {
  max-width: 100%;
  padding: 10px var(--aid-space-3);
  border-radius: var(--aid-radius-lg);
  color: var(--aid-text);
  word-break: break-word;
}

.message.user {
  align-self: flex-end;
  background: var(--aid-bg-hover);
  border-bottom-right-radius: var(--aid-radius-sm);
}

.user-text { margin: 0; white-space: pre-wrap; }

.user-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-1);
  margin-top: var(--aid-space-2);
}

.assistant-item {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  min-width: 0;
  color: var(--aid-text);
}

.markdown {
  min-width: 0;
  color: var(--aid-text);
  font-size: var(--aid-text-md);
  line-height: var(--aid-line);
}

.markdown p { margin: 0 0 var(--aid-space-2); }
.markdown p:last-child { margin-bottom: 0; }

.markdown ul, .markdown ol {
  margin: 0 0 var(--aid-space-2);
  padding-left: var(--aid-space-5);
}

.markdown li { margin: 0; }

.markdown code, .tool-row-label code {
  font-family: var(--aid-mono);
  font-size: 0.92em;
  padding: 0.1em 0.35em;
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg-hover);
}

.md-code {
  position: relative;
  margin: var(--aid-space-2) 0;
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  background: var(--aid-bg);
  overflow: auto;
}

.md-code [data-action="copy-code"] {
  position: absolute;
  top: var(--aid-space-1);
  right: var(--aid-space-1);
  z-index: 1;
  padding: var(--aid-space-1) var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg-hover);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
}

.md-code [data-action="copy-code"]:hover { color: var(--aid-text); }

.md-code pre {
  margin: 0;
  padding: var(--aid-space-3);
  overflow: auto;
  font-family: var(--aid-mono);
  font-size: var(--aid-text-sm);
  line-height: var(--aid-line);
}

.md-code code {
  padding: 0;
  background: transparent;
  font-family: var(--aid-mono);
}

.tool-row {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  background: var(--aid-bg);
}

.tool-row-toggle {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  width: 100%;
  min-height: 32px;
  padding: var(--aid-space-1) var(--aid-space-2);
  text-align: left;
  color: var(--aid-text);
}

.tool-row-toggle:disabled { cursor: default; opacity: 1; }

.tool-row-icon {
  display: inline-flex;
  color: var(--aid-text-muted);
}

.tool-row-label {
  flex: 1;
  min-width: 0;
  font-size: var(--aid-text-sm);
  font-weight: 560;
}

.tool-row-state {
  display: inline-flex;
  flex: none;
  color: var(--aid-text-muted);
}

.tool-mark.ok { color: var(--aid-success); font-weight: 700; }
.tool-mark.error { color: var(--aid-danger); font-weight: 700; }

.tool-row-details {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  padding: 0 var(--aid-space-2) var(--aid-space-2);
  border-top: 1px solid var(--aid-border);
}

.tool-args, .tool-result {
  margin: 0;
  max-height: 12em;
  overflow: auto;
  padding: var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg-hover);
  color: var(--aid-text-muted);
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.files-block {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-1);
  font-size: var(--aid-text-sm);
}

.files-block li {
  display: flex;
  align-items: baseline;
  gap: var(--aid-space-2);
  min-width: 0;
}

.files-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--aid-mono);
  font-size: var(--aid-text-xs);
}

.files-add { color: var(--aid-success); font-variant-numeric: tabular-nums; }
.files-del { color: var(--aid-danger); font-variant-numeric: tabular-nums; }

.run-footer {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  padding-top: var(--aid-space-1);
}

.run-footer-meta {
  margin: 0;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
}

.run-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
}

.chat-notice {
  align-self: stretch;
  padding: var(--aid-space-2) var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  border: 1px solid var(--aid-border);
  background: var(--aid-bg);
  color: var(--aid-text);
}

.chat-notice-info { border-left: 3px solid var(--aid-accent); }
.chat-notice-warning {
  border-left: 3px solid var(--aid-warning);
  background: color-mix(in srgb, var(--aid-warning) 10%, var(--aid-bg));
}
.chat-notice-error {
  border-left: 3px solid var(--aid-danger);
  background: var(--aid-del-bg);
}

.chat-notice-text { margin: 0; font-size: var(--aid-text-sm); }

.chat-notice-setup {
  margin: var(--aid-space-2) 0 0;
  padding-left: var(--aid-space-5);
  font-size: var(--aid-text-sm);
}

.chat-notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
  margin-top: var(--aid-space-2);
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: var(--aid-space-3);
  transform: translateX(-50%);
  z-index: 1;
  padding: var(--aid-space-1) var(--aid-space-3);
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
  box-shadow: var(--aid-shadow-lg);
  font-size: var(--aid-text-sm);
  font-weight: 620;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
  padding-bottom: var(--aid-space-3);
}

.suggestions button {
  padding: 5px 10px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
}

.suggestions button:hover { background: var(--aid-bg-hover); color: var(--aid-text); filter: brightness(1.08); }

.composer {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  padding-top: var(--aid-space-3);
  padding-bottom: 14px;
  border-top: 1px solid var(--aid-border);
  background: var(--aid-bg);
}

.composer-input { position: relative; }

.mention-listbox {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + var(--aid-space-1));
  z-index: var(--aid-z-popover);
  margin: 0;
  padding: var(--aid-space-1);
  max-height: 12em;
  overflow: auto;
  list-style: none;
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  background: var(--aid-bg-raised);
  box-shadow: var(--aid-shadow-lg);
}

.mention-listbox li {
  padding: var(--aid-space-1) var(--aid-space-2);
  border-radius: var(--aid-radius-sm);
  color: var(--aid-text);
  font-size: var(--aid-text-sm);
  cursor: pointer;
}

.mention-listbox li.active,
.mention-listbox li[aria-selected='true'] {
  background: var(--aid-bg-hover);
}

.mention-empty {
  color: var(--aid-text-muted);
  cursor: default;
}

.composer-pickers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-2);
}

.history-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: var(--aid-space-2);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-1);
}

.history-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--aid-space-1);
  width: 100%;
  padding: var(--aid-space-2) var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  text-align: left;
  color: var(--aid-text);
}

.history-item:hover,
.history-item[aria-current='true'] {
  background: var(--aid-bg-hover);
}

.history-title {
  font-weight: 620;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.history-meta {
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
}

.provider {
  align-self: flex-start;
  max-width: 100%;
  padding: 6px 28px 6px 10px;
  border-radius: var(--aid-radius-md);
  border: 1px solid var(--aid-border);
  background:
    linear-gradient(45deg, transparent 50%, var(--aid-text-muted) 50%) no-repeat right 14px top 50% / 5px 5px,
    linear-gradient(-45deg, var(--aid-text-muted) 50%, transparent 50%) no-repeat right 10px top 50% / 5px 5px,
    var(--aid-bg);
  appearance: none;
}

.hint {
  margin: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--aid-warning);
  font-size: var(--aid-text-xs);
  line-height: var(--aid-line);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.composer textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  padding: 10px var(--aid-space-3);
  border-radius: var(--aid-radius-md);
  border: 1px solid var(--aid-border);
  background: var(--aid-bg);
  color: var(--aid-text);
  outline: none;
  font-family: var(--aid-font);
}

.composer textarea::placeholder { color: var(--aid-text-muted); }

.composer textarea:focus { border-color: var(--aid-accent); }

.shortcut {
  margin-right: auto;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
}
`;
