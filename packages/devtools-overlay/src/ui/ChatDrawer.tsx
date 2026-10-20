import type { ProviderType, SelectedElement } from '@gateway/shared-types';
import { selectionChipLabel } from '../inspector/locator.js';

export interface ChatLine {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

export interface ChatDrawerProps {
  selected: SelectedElement | null;
  provider: ProviderType;
  prompt: string;
  messages: ChatLine[];
  sending: boolean;
  onPromptChange: (value: string) => void;
  onProviderChange: (provider: ProviderType) => void;
  onClearSelection: () => void;
  onSuggest: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onClose: () => void;
}

const PROVIDERS: Array<{ id: ProviderType; label: string }> = [
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

const SUGGESTIONS = ['Fix layout', 'Make responsive', 'Add hover state'];

export function ChatDrawer({
  selected,
  provider,
  prompt,
  messages,
  sending,
  onPromptChange,
  onProviderChange,
  onClearSelection,
  onSuggest,
  onSubmit,
  onStop,
  onClose,
}: ChatDrawerProps) {
  return (
    <section className="drawer" aria-label="Chat">
      <header className="drawer-header">
        <h2>Chat</h2>
        <button type="button" className="icon-button" data-action="close-chat" onClick={onClose}>
          ✕
        </button>
      </header>
      {selected ? (
        <div className="chip-row">
          <div className="chip">
            <span>[{selectionChipLabel(selected)}]</span>
            <button
              type="button"
              className="icon-button"
              data-action="clear-selection"
              aria-label="Clear selection"
              onClick={onClearSelection}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
      <div className="messages" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}${message.pending ? ' pending' : ''}`}>
            {message.text || (message.pending ? 'Waiting for the gateway…' : '')}
          </div>
        ))}
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => onSuggest(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!sending) onSubmit();
        }}
      >
        <select
          className="provider"
          data-action="provider"
          value={provider}
          aria-label="Provider"
          onChange={(event) => {
            const value = event.currentTarget.value;
            const match = PROVIDERS.find((item) => item.id === value);
            if (match) onProviderChange(match.id);
          }}
        >
          {PROVIDERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <textarea
          value={prompt}
          placeholder="Describe the change"
          aria-label="Prompt"
          onInput={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!sending) onSubmit();
            }
          }}
        />
        <div className="composer-actions">
          {sending ? (
            <button type="button" className="ghost" data-action="stop" onClick={onStop}>
              Stop
            </button>
          ) : null}
          <button type="submit" className="primary" data-action="send" disabled={sending || prompt.trim().length === 0}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
