import type { ProviderType, RunMode } from '@aidev/protocol';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Composer, mentionToken, type MentionOption, type ProviderOption } from './chat/Composer.js';
import { HistoryList, type HistoryRow } from './chat/HistoryList.js';
import { Transcript } from './chat/Transcript.js';
import type { ChatState, ContextChip, NoticeItem } from './chat/model.js';

export interface ChatDrawerProps {
  provider: ProviderType;
  model: string | null;
  mode: RunMode;
  providers: ProviderOption[];
  gatewayStatus: 'connected' | 'idle';
  prompt: string;
  chat: ChatState;
  chips: ContextChip[];
  suggestions: string[];
  sending: boolean;
  historyOpen: boolean;
  historyRows: HistoryRow[];
  historyLoading: boolean;
  historyError: string | null;
  threadId: string | null;
  onPromptChange: (value: string) => void;
  onProviderChange: (provider: ProviderType) => void;
  onModelChange: (model: string | null) => void;
  onModeChange: (mode: RunMode) => void;
  onRemoveChip: (chip: ContextChip) => void;
  onSuggest: (text: string) => void;
  onSearchFiles: (query: string) => Promise<string[]>;
  onSubmit: () => void;
  onStop: () => void;
  onReview: (runId: string) => void;
  onUndo: (runId: string) => void;
  onKeepGoing: () => void;
  onNoticeAction: (item: NoticeItem, action: string) => void;
  onResumeThread: (threadId: string) => void;
  onEscapeOverlay: (handler: () => boolean) => void;
}

const SEARCH_DEBOUNCE_MS = 120;

export function ChatDrawer({
  provider,
  model,
  mode,
  providers,
  gatewayStatus,
  prompt,
  chat,
  chips,
  suggestions,
  sending,
  historyOpen,
  historyRows,
  historyLoading,
  historyError,
  threadId,
  onPromptChange,
  onProviderChange,
  onModelChange,
  onModeChange,
  onRemoveChip,
  onSuggest,
  onSearchFiles,
  onSubmit,
  onStop,
  onReview,
  onUndo,
  onKeepGoing,
  onNoticeAction,
  onResumeThread,
  onEscapeOverlay,
}: ChatDrawerProps) {
  const providerLabel = providers.find((item) => item.id === provider)?.label ?? provider;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const caretRef = useRef(0);
  const searchGen = useRef(0);

  const hasSelection = chips.some((chip) => chip.kind === 'selection');
  const mentionOptions = useMemo(
    () => mentionChoices(mentionQuery, hasSelection, fileHits),
    [mentionQuery, hasSelection, fileHits],
  );

  useEffect(() => {
    if (mentionQuery === null) {
      setFileHits([]);
      setMentionLoading(false);
      return;
    }
    const gen = (searchGen.current += 1);
    setMentionLoading(true);
    const timer = window.setTimeout(() => {
      void onSearchFiles(mentionQuery)
        .then((files) => {
          if (searchGen.current !== gen) return;
          setFileHits(files);
        })
        .catch(() => {
          if (searchGen.current !== gen) return;
          setFileHits([]);
        })
        .finally(() => {
          if (searchGen.current === gen) setMentionLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [mentionQuery, onSearchFiles]);

  function updatePrompt(value: string, caret: number): void {
    caretRef.current = caret;
    onPromptChange(value);
    const token = mentionToken(value, caret);
    setMentionQuery(token ? token.query : null);
  }

  return (
    <section className="panel" aria-label="Chat">
      {historyOpen ? (
        <HistoryList
          rows={historyRows}
          loading={historyLoading}
          error={historyError}
          activeThreadId={threadId}
          onSelect={onResumeThread}
        />
      ) : (
        <Transcript
          items={chat.items}
          emptyTitle={`Edit this page with ${providerLabel}`}
          emptyHint="Inspect an element, describe the change, and send. The agent edits the project and Vite reloads the page."
          onReview={onReview}
          onUndo={onUndo}
          onKeepGoing={onKeepGoing}
          onNoticeAction={onNoticeAction}
        />
      )}
      {historyOpen ? null : (
        <Composer
          prompt={prompt}
          chips={chips}
          suggestions={suggestions}
          provider={provider}
          model={model}
          mode={mode}
          providers={providers}
          gatewayStatus={gatewayStatus}
          sending={sending}
          mentionOpen={mentionQuery !== null}
          mentionOptions={mentionOptions}
          mentionLoading={mentionLoading}
          onPromptChange={updatePrompt}
          onCaret={(caret) => {
            caretRef.current = caret;
            const token = mentionToken(prompt, caret);
            setMentionQuery(token ? token.query : null);
          }}
          onRemoveChip={onRemoveChip}
          onSuggest={onSuggest}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onModeChange={onModeChange}
          onMentionQuery={setMentionQuery}
          onSubmit={onSubmit}
          onStop={onStop}
          onEscapeOverlay={onEscapeOverlay}
        />
      )}
    </section>
  );
}

function mentionChoices(query: string | null, hasSelection: boolean, files: readonly string[]): MentionOption[] {
  if (query === null) return [];
  const needle = query.toLowerCase();
  const options: MentionOption[] = [];
  if (hasSelection && '@selection'.slice(0, needle.length + 1) === `@${needle}`) {
    options.push({ id: 'selection', label: '@selection', insert: '@selection' });
  } else if (hasSelection && 'selection'.includes(needle)) {
    options.push({ id: 'selection', label: '@selection', insert: '@selection' });
  }
  for (const file of files) {
    options.push({ id: `file:${file}`, label: file, insert: `@${file}` });
  }
  return options;
}
