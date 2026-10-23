import type { ProviderType, SelectedElement } from '@aidev/protocol';
import { selectionChipLabel } from '../inspector/locator.js';
import { EmptyState } from './EmptyState.js';
import { MessageSquareIcon, XIcon } from './icons.js';
import { sendShortcutHint } from './keyboard.js';

export interface ChatLine {
  id: string;
  role: 'user' | 'assistant' | 'status';
  text: string;
  pending?: boolean;
  error?: boolean;
}

export interface ChatDrawerProps {
  selected: SelectedElement | null;
  provider: ProviderType;
  availability: Partial<Record<ProviderType, boolean>>;
  gatewayStatus: 'connected' | 'idle';
  prompt: string;
  messages: ChatLine[];
  sending: boolean;
  onPromptChange: (value: string) => void;
  onProviderChange: (provider: ProviderType) => void;
  onClearSelection: () => void;
  onSuggest: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

const PROVIDERS: Array<{ id: ProviderType; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

const SUGGESTIONS = ['Fix layout', 'Make responsive', 'Add hover state'];

export function ChatDrawer({
  selected,
  provider,
  availability,
  gatewayStatus,
  prompt,
  messages,
  sending,
  onPromptChange,
  onProviderChange,
  onClearSelection,
  onSuggest,
  onSubmit,
  onStop,
}: ChatDrawerProps) {
  const providerLabel = PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
  const known = Object.prototype.hasOwnProperty.call(availability, provider);
  const unavailable = known && availability[provider] === false;
  const unavailableReason = `${providerLabel} is not on PATH. Install it, sign in, and restart the gateway.`;
  const conversation = messages.some((message) => message.role !== 'status');

  return (
    <section className="panel" aria-label="Chat">
      {selected ? (
        <div className="chip-row">
          <div className="chip">
            <span>[{selectionChipLabel(selected)}]</span>
            <button
              type="button"
              className="icon-button"
              data-action="clear-selection"
              aria-label="Clear selection"
              title="Clear selection"
              onClick={onClearSelection}
            >
              <XIcon />
            </button>
          </div>
        </div>
      ) : null}
      <div className="messages" aria-live="polite">
        {conversation ? (
          messages.map((message) =>
            message.role === 'status' ? (
              <div key={message.id} className="activity">
                {message.text}
              </div>
            ) : (
              <div
                key={message.id}
                className={`message ${message.role}${message.pending ? ' pending' : ''}${message.error ? ' error' : ''}`}
              >
                {message.text || (message.pending ? 'Waiting for the gateway…' : '')}
              </div>
            ),
          )
        ) : (
          <EmptyState
            icon={<MessageSquareIcon size={24} />}
            title={`Edit this page with ${providerLabel}`}
            hint="Inspect an element, describe the change, and send. The agent edits the project and Vite reloads the page."
          />
        )}
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
          if (!sending && !unavailable) onSubmit();
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
          {PROVIDERS.map((item) => {
            const ready = availability[item.id];
            const suffix = ready === false ? ' · not installed' : ready === true ? '' : '';
            return (
              <option key={item.id} value={item.id} disabled={ready === false}>
                {item.label}
                {suffix}
              </option>
            );
          })}
        </select>
        {unavailable ? (
          <p className="hint" title={unavailableReason}>
            {unavailableReason}
          </p>
        ) : null}
        {gatewayStatus === 'idle' ? <p className="hint">Gateway offline</p> : null}
        <textarea
          value={prompt}
          placeholder="Change the hero button to a deep violet with fully rounded corners"
          aria-label="Prompt"
          onInput={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!sending && !unavailable) onSubmit();
            }
          }}
        />
        <div className="composer-actions">
          <span className="shortcut">{sendShortcutHint()}</span>
          {sending ? (
            <button type="button" className="ghost" data-action="stop" onClick={onStop}>
              Stop
            </button>
          ) : null}
          <button
            type="submit"
            className="primary"
            data-action="send"
            disabled={sending || unavailable || prompt.trim().length === 0}
            title={unavailable ? unavailableReason : undefined}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
