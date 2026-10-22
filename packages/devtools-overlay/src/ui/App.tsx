import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GitCommitRequest, GitDiffSummary, ProviderType, SelectedElement } from '@gateway/shared-types';
import type { ProviderStatus } from '../types.js';
import { gatherContext } from '../context/index.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import type { DevtoolsConfig, DevtoolsPanel } from '../types.js';
import { createDevtoolsBridge } from './bridge.js';
import { ChatDrawer, type ChatLine } from './ChatDrawer.js';
import { GatewayCancelledError, GatewayClient } from './client.js';
import { DiffViewer } from './DiffViewer.js';
import { TerminalPanel } from './Terminal.js';
import { TestRunner } from './TestRunner.js';
import { Toolbar } from './Toolbar.js';

export interface AppProps {
  config: DevtoolsConfig;
}

const REVIEW_NOTICE = 'The agent edited files. Review the diffs before committing.';

export function App({ config }: AppProps) {
  const [inspecting, setInspecting] = useState(false);
  const [panel, setPanel] = useState<DevtoolsPanel | null>(null);
  const [status, setStatus] = useState<'connected' | 'idle'>('idle');
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [provider, setProvider] = useState<ProviderType>('cursor');
  const [availability, setAvailability] = useState<Partial<Record<ProviderType, boolean>>>({});
  const providerTouched = useRef(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffCount, setDiffCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const elementRef = useRef<Element | null>(null);
  const pickerRef = useRef<ElementPicker | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const client = useMemo(
    () =>
      config.client ??
      new GatewayClient({
        gatewayUrl: config.gatewayUrl,
        cwd: config.cwd,
        transport: config.transport,
      }),
    [config.client, config.cwd, config.gatewayUrl, config.transport],
  );
  const bridge = useMemo(() => config.bridge ?? createDevtoolsBridge(), [config.bridge]);

  const refreshDiffs = useCallback(async (): Promise<number> => {
    setDiffLoading(true);
    try {
      const next = await bridge.gitDiff();
      setSummary(next);
      setDiffCount(next.files.length);
      setDiffError(null);
      return next.files.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the diff';
      if (message !== 'Dev server bridge is unavailable') setDiffError(message);
      return 0;
    } finally {
      setDiffLoading(false);
    }
  }, [bridge]);

  useLayoutEffect(() => {
    const picker = new ElementPicker({
      onSelect(element) {
        elementRef.current = element;
        setSelected(locateElement(element));
        setInspecting(false);
        setPanel('chat');
      },
      onCancel() {
        setInspecting(false);
      },
    });
    pickerRef.current = picker;
    return () => {
      picker.stop();
      pickerRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (inspecting) picker.start();
    else picker.stop();
  }, [inspecting]);

  useLayoutEffect(() => {
    const node = drawerRef.current?.querySelector('.messages');
    if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight;
  }, [messages, panel]);

  useEffect(() => {
    void refreshDiffs();
  }, [refreshDiffs]);

  useEffect(() => {
    if (panel === 'diffs') void refreshDiffs();
  }, [panel, refreshDiffs]);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      void client.checkHealth().then(
        (ok) => {
          if (!cancelled) setStatus(ok ? 'connected' : 'idle');
        },
        () => {
          if (!cancelled) setStatus('idle');
        },
      );
      if (!client.listProviders) return;
      void client.listProviders().then((listed) => {
        if (cancelled || listed.length === 0) return;
        setAvailability(availabilityMap(listed));
        if (providerTouched.current) return;
        setProvider(preferredProvider(listed));
      });
    };
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client]);

  function updateAssistant(id: string, next: (current: string) => string, pending: boolean): void {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, text: next(message.text), pending } : message,
      ),
    );
  }

  function selectPanel(next: DevtoolsPanel): void {
    setPanel((current) => (current === next ? null : next));
  }

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text || sending) return;
    const assistantId = createId();
    let sawEdit = false;
    setPrompt('');
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: createId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', pending: true },
    ]);
    try {
      const live = elementRef.current;
      const selectedElement = live?.isConnected ? locateElement(live) : selected ?? undefined;
      const context = await gatherContext(selectedElement, live);
      await client.streamPrompt({
        provider,
        prompt: text,
        cwd: config.cwd,
        context,
        onChunk(chunk) {
          updateAssistant(assistantId, (current) => current + chunk, false);
        },
        onTool(toolName, filePath) {
          const label = activityLabel(toolName, filePath);
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === 'status' && last.text === label) return current;
            return [...current, { id: createId(), role: 'status', text: label }];
          });
        },
        onFileEdit() {
          sawEdit = true;
        },
        onError(message) {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    text: item.text ? `${item.text}\n${message}` : message,
                    pending: false,
                    error: true,
                  }
                : item,
            ),
          );
        },
        onDone() {
          updateAssistant(assistantId, (current) => current || 'The agent finished without text output.', false);
          if (!sawEdit) return;
          void refreshDiffs().then((count) => {
            if (count > 0) setNotice(REVIEW_NOTICE);
          });
        },
      });
    } catch (error) {
      if (error instanceof GatewayCancelledError) {
        updateAssistant(assistantId, (current) => current || 'Stopped.', false);
      } else {
        const message = error instanceof Error ? error.message : 'Prompt failed';
        updateAssistant(assistantId, (current) => (current ? `${current}\n${message}` : message), false);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="dock">
      {inspecting ? (
        <div className="inspect-banner" role="status">
          Click an element to attach it. Press Esc to cancel.
        </div>
      ) : null}
      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            data-action="review-diffs"
            onClick={() => {
              setNotice(null);
              setPanel('diffs');
            }}
          >
            Review diffs
          </button>
          <button type="button" className="icon-button" data-action="dismiss-notice" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}
      <Toolbar
        inspecting={inspecting}
        panel={panel}
        diffCount={diffCount}
        status={status}
        onToggleInspect={() => setInspecting((value) => !value)}
        onSelectPanel={selectPanel}
      />
      {panel ? (
        <div ref={drawerRef}>
          {panel === 'chat' ? (
            <ChatDrawer
              selected={selected}
              provider={provider}
              availability={availability}
              gatewayStatus={status}
              prompt={prompt}
              messages={messages}
              sending={sending}
              onPromptChange={setPrompt}
              onProviderChange={(next) => {
                providerTouched.current = true;
                setProvider(next);
              }}
              onClearSelection={() => {
                elementRef.current = null;
                setSelected(null);
              }}
              onSuggest={setPrompt}
              onSubmit={() => {
                void submit();
              }}
              onStop={() => client.cancel()}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel === 'diffs' ? (
            <DiffViewer
              summary={summary}
              loading={diffLoading}
              error={diffError}
              onCommit={async (request: GitCommitRequest) => {
                const result = await bridge.gitCommit(request);
                await refreshDiffs();
                return result;
              }}
              onDiscard={async (files) => {
                await bridge.gitRevert(files);
                await refreshDiffs();
              }}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel === 'terminal' ? <TerminalPanel bridge={bridge} onClose={() => setPanel(null)} /> : null}
          {panel === 'tests' ? <TestRunner bridge={bridge} onClose={() => setPanel(null)} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function availabilityMap(listed: ProviderStatus[]): Partial<Record<ProviderType, boolean>> {
  const next: Partial<Record<ProviderType, boolean>> = {};
  for (const item of listed) next[item.provider] = item.available;
  return next;
}

function preferredProvider(listed: ProviderStatus[]): ProviderType {
  if (listed.some((item) => item.provider === 'cursor' && item.available)) return 'cursor';
  return listed.find((item) => item.available)?.provider ?? 'cursor';
}

function activityLabel(toolName: string, filePath?: string): string {
  const key = toolName.toLowerCase();
  const verb = key.includes('write')
    ? 'Writing'
    : key.includes('edit') || key.includes('patch') || key.includes('strreplace')
      ? 'Editing'
      : key.includes('shell') || key.includes('bash')
        ? 'Running'
        : key.includes('read')
          ? 'Reading'
          : key.includes('grep') || key.includes('search')
            ? 'Searching'
            : toolName;
  if (!filePath) return verb;
  const short = filePath.split('/').slice(-2).join('/');
  return `${verb} ${short}`;
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
