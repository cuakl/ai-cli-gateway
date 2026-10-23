export const CHAT_CSS = `
.chip-row { padding-top: 10px; padding-bottom: var(--aid-space-1); }

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

.messages {
  flex: 1;
  overflow: auto;
  padding: var(--aid-space-3) 14px;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
}

.empty-state {
  margin: auto 0;
  padding: var(--aid-space-2) var(--aid-space-1) var(--aid-space-4);
}

.empty-title {
  margin: 0 0 6px;
  color: var(--aid-text);
  font-size: var(--aid-text-lg);
  font-weight: 620;
  letter-spacing: -0.03em;
}

.empty-copy {
  margin: 0;
  max-width: 36em;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-md);
  line-height: var(--aid-line);
}

.message {
  max-width: 100%;
  padding: 10px var(--aid-space-3);
  border-radius: var(--aid-radius-lg);
  color: var(--aid-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.message.user {
  align-self: flex-end;
  background: var(--aid-bg-hover);
  border-bottom-right-radius: var(--aid-radius-sm);
}

.message.assistant {
  align-self: flex-start;
  background: var(--aid-bg);
  border: 1px solid var(--aid-border);
  border-bottom-left-radius: var(--aid-radius-sm);
}

.message.pending { color: var(--aid-text-muted); }

.message.error {
  background: var(--aid-del-bg);
  border-color: color-mix(in srgb, var(--aid-danger) 45%, transparent);
  color: var(--aid-text);
}

.activity {
  align-self: flex-start;
  padding: 2px 2px 2px 10px;
  border-left: 2px solid var(--aid-accent);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
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
