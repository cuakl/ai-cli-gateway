import type { ProviderType, RunMode } from '@aidev/protocol';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { XIcon } from '../icons.js';
import { sendShortcutHint } from '../keyboard.js';
import type { ContextChip } from './model.js';

export interface ProviderOption {
  id: ProviderType;
  label: string;
  available: boolean;
  experimental: boolean;
  setup?: string;
  models: Array<{ id: string; label: string }>;
  modes: RunMode[];
}

export interface MentionOption {
  id: string;
  label: string;
  insert: string;
}

export interface ComposerProps {
  prompt: string;
  chips: ContextChip[];
  suggestions: string[];
  provider: ProviderType;
  model: string | null;
  mode: RunMode;
  providers: ProviderOption[];
  gatewayStatus: 'connected' | 'idle';
  sending: boolean;
  mentionOpen: boolean;
  mentionOptions: MentionOption[];
  mentionLoading: boolean;
  onPromptChange: (value: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onRemoveChip: (chip: ContextChip) => void;
  onSuggest: (text: string) => void;
  onProviderChange: (provider: ProviderType) => void;
  onModelChange: (model: string | null) => void;
  onModeChange: (mode: RunMode) => void;
  onMentionQuery: (query: string | null) => void;
  onSubmit: () => void;
  onStop: () => void;
  onEscapeOverlay: (handler: () => boolean) => void;
}

const PROVIDER_ORDER: ProviderType[] = ['cursor', 'claude', 'codex', 'antigravity'];

export function Composer({
  prompt,
  chips,
  suggestions,
  provider,
  model,
  mode,
  providers,
  gatewayStatus,
  sending,
  mentionOpen,
  mentionOptions,
  mentionLoading,
  onPromptChange,
  onCaret,
  onRemoveChip,
  onSuggest,
  onProviderChange,
  onModelChange,
  onModeChange,
  onMentionQuery,
  onSubmit,
  onStop,
  onEscapeOverlay,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();
  const [activeMention, setActiveMention] = useState(0);
  const listed = providers.length > 0 ? providers : fallbackProviders();
  const current = listed.find((item) => item.id === provider) ?? listed[0];
  const unavailable = current ? current.available === false : false;
  const unavailableReason =
    current?.setup ??
    `${current?.label ?? provider} is not on PATH. Install it, sign in, and restart the gateway.`;
  const models = current?.models ?? [];
  const supportsAsk = current?.modes.includes('ask') !== false;
  const activeOption = mentionOptions[activeMention];
  const activeDescendant = activeOption ? `${listboxId}-${activeOption.id}` : undefined;

  useEffect(() => {
    setActiveMention(0);
  }, [mentionOptions]);

  useEffect(() => {
    onEscapeOverlay(() => {
      if (!mentionOpen) return false;
      onMentionQuery(null);
      return true;
    });
    return () => onEscapeOverlay(() => false);
  }, [mentionOpen, onEscapeOverlay, onMentionQuery]);

  function moveMention(delta: number): void {
    if (mentionOptions.length === 0) return;
    setActiveMention((currentIndex) => {
      return (currentIndex + delta + mentionOptions.length) % mentionOptions.length;
    });
  }

  function applyMention(option: MentionOption): void {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? prompt.length;
    const next = insertMention(prompt, caret, option.insert);
    onPromptChange(next.text, next.caret);
    onMentionQuery(null);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <>
      {suggestions.length > 0 ? (
        <div className="suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-action="suggestion"
              onClick={() => onSuggest(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="chip-row" data-action="chip-row">
          {chips.map((chip) => (
            <div key={chip.id} className="chip" data-chip={chip.kind} title={chip.preview ?? chip.label}>
              {chip.thumbnail ? (
                <img className="chip-thumb" src={chip.thumbnail} alt="" />
              ) : null}
              <span>{chip.label}</span>
              <button
                type="button"
                className="icon-button"
                data-action="remove-chip"
                data-chip-id={chip.id}
                aria-label={`Remove ${chip.label}`}
                title={`Remove ${chip.label}`}
                onClick={() => onRemoveChip(chip)}
              >
                <XIcon />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!sending && !unavailable) onSubmit();
        }}
      >
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            value={prompt}
            placeholder="Describe a change · @ to mention a file"
            aria-label="Prompt"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={mentionOpen}
            aria-controls={listboxId}
            aria-activedescendant={mentionOpen ? activeDescendant : undefined}
            onInput={(event) => {
              const node = event.currentTarget;
              onPromptChange(node.value, node.selectionStart ?? node.value.length);
            }}
            onClick={(event) => onCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyUp={(event) => onCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={(event) => {
              if (mentionOpen) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveMention(1);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveMention(-1);
                  return;
                }
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  if (activeOption) applyMention(activeOption);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onMentionQuery(null);
                  return;
                }
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (!sending && !unavailable) onSubmit();
              }
            }}
          />
          {mentionOpen ? (
            <ul
              id={listboxId}
              className="mention-listbox"
              role="listbox"
              data-action="mention-listbox"
              aria-label="Mentions"
            >
              {mentionLoading && mentionOptions.length === 0 ? (
                <li className="mention-empty">Searching files…</li>
              ) : null}
              {mentionOptions.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listboxId}-${option.id}`}
                  role="option"
                  data-action="mention-option"
                  data-mention={option.id}
                  aria-selected={index === activeMention}
                  className={index === activeMention ? 'active' : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(option);
                  }}
                >
                  {option.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="composer-pickers">
          <select
            className="provider"
            data-action="provider"
            value={provider}
            aria-label="Provider"
            title={unavailable ? unavailableReason : current?.experimental ? 'experimental' : undefined}
            onChange={(event) => {
              const match = listed.find((item) => item.id === event.currentTarget.value);
              if (match) onProviderChange(match.id);
            }}
          >
            {listed.map((item) => {
              const tag = !item.available ? 'not installed' : item.experimental ? 'experimental' : '';
              return (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={!item.available}
                  title={item.setup}
                >
                  {item.label}
                  {tag ? ` · ${tag}` : ''}
                </option>
              );
            })}
          </select>
          <select
            className="provider"
            data-action="model"
            value={model ?? ''}
            aria-label="Model"
            onChange={(event) => {
              const value = event.currentTarget.value;
              onModelChange(value.length > 0 ? value : null);
            }}
          >
            <option value="">Default</option>
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="provider"
            data-action="mode"
            value={mode === 'ask' && supportsAsk ? 'ask' : 'agent'}
            aria-label="Mode"
            onChange={(event) => {
              onModeChange(event.currentTarget.value === 'ask' ? 'ask' : 'agent');
            }}
          >
            <option value="agent">Agent</option>
            <option value="ask" disabled={!supportsAsk} title={supportsAsk ? undefined : 'Ask mode is not available for this provider'}>
              Ask
            </option>
          </select>
        </div>
        {unavailable ? (
          <p className="hint" title={unavailableReason}>
            {unavailableReason}
          </p>
        ) : null}
        {gatewayStatus === 'idle' ? <p className="hint">Gateway offline</p> : null}
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
    </>
  );
}

export function mentionToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(])@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const prev = before[at - 1];
  if (prev && /[\w.]/.test(prev)) return null;
  return { start: at, query: match[2] ?? '' };
}

export function insertMention(text: string, caret: number, insert: string): { text: string; caret: number } {
  const token = mentionToken(text, caret);
  if (!token) {
    const next = `${text}${insert} `;
    return { text: next, caret: next.length };
  }
  const next = `${text.slice(0, token.start)}${insert} ${text.slice(caret)}`;
  return { text: next, caret: token.start + insert.length + 1 };
}

function fallbackProviders(): ProviderOption[] {
  return PROVIDER_ORDER.map((id) => ({
    id,
    label: providerLabel(id),
    available: true,
    experimental: false,
    models: [],
    modes: ['agent', 'ask', 'plan'],
  }));
}

export function providerLabel(id: ProviderType): string {
  switch (id) {
    case 'cursor':
      return 'Cursor';
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'antigravity':
      return 'Antigravity';
    default:
      return id;
  }
}
