import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GitDiffSummary, ProviderType, SelectedElement, UnifiedStreamEvent } from '@aidev/protocol';
import { gatherContext } from '../context/index.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import { DEFAULT_GATEWAY_URL, type DevtoolsConfig, type DevtoolsPanel, type ProviderStatus } from '../types.js';
import { ChatDrawer, type ChatLine } from './ChatDrawer.js';
import { DiffViewer } from './DiffViewer.js';
import { XIcon } from './icons.js';
import { TerminalPanel } from './Terminal.js';
import { TestRunner } from './TestRunner.js';
import { Toolbar } from './Toolbar.js';
import {
  WorkspaceClient,
  WorkspaceError,
  type WorkspaceConnection,
  type WorkspaceConnectionState,
} from './workspace-client.js';

export interface AppProps {
  config: DevtoolsConfig;
}

const REVIEW_NOTICE = 'The agent edited files. Review the diffs before committing.';

const disconnectedWorkspace: WorkspaceConnection = {
  state: 'closed',
  request() {
    return Promise.reject(new WorkspaceError('disconnected', 'Workspace is not connected'));
  },
  send() {},
  on() {
    return () => {};
  },
  onStateChange() {
    return () => {};
  },
  close() {},
};

export function App({ config }: AppProps) {
  const [inspecting, setInspecting] = useState(false);
  const [panel, setPanel] = useState<DevtoolsPanel | null>(null);
  const [terminalMounted, setTerminalMounted] = useState(false);
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
  const stopRun = useRef<(() => void) | null>(null);
  const runCleanup = useRef<(() => void) | null>(null);

  const workspace = useMemo<WorkspaceConnection>(() => {
    if (config.workspace) return config.workspace;
    if (!config.projectId || !config.browserToken) return disconnectedWorkspace;
    return new WorkspaceClient({
      gatewayUrl: config.gatewayUrl ?? DEFAULT_GATEWAY_URL,
      projectId: config.projectId,
      browserToken: config.browserToken,
    });
  }, [config.browserToken, config.gatewayUrl, config.projectId, config.workspace]);

  const refreshDiffs = useCallback(async (): Promise<number> => {
    setDiffLoading(true);
    try {
      const result = await workspace.request({ type: 'git.diff' });
      setSummary(result.summary);
      setDiffCount(result.summary.files.length);
      setDiffError(null);
      return result.summary.files.length;
    } catch (error) {
      const message = visibleDiffError(error);
      setDiffError(message);
      return 0;
    } finally {
      setDiffLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (config.workspace || workspace === disconnectedWorkspace) return;
    return () => workspace.close();
  }, [config.workspace, workspace]);

  useEffect(() => () => runCleanup.current?.(), []);

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

  useLayoutEffect(() => {
    void refreshDiffs();
    return workspace.on('git.changed', (message) => {
      setSummary(message.summary);
      setDiffCount(message.summary.files.length);
      setDiffError(null);
      setDiffLoading(false);
    });
  }, [refreshDiffs, workspace]);

  useLayoutEffect(() => {
    const apply = (state: WorkspaceConnectionState): void => {
      setStatus(state === 'open' ? 'connected' : 'idle');
      if (state === 'open') void refreshDiffs();
    };
    apply(workspace.state);
    return workspace.onStateChange(apply);
  }, [refreshDiffs, workspace]);

  useLayoutEffect(() => {
    let cancelled = false;
    const load = (): void => {
      const token = config.browserToken;
      if (!token || workspace.state !== 'open') return;
      const gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;
      void fetchProviderAvailability(gatewayUrl, token)
        .then((listed) => {
          if (cancelled || listed.length === 0) return;
          setAvailability(availabilityMap(listed));
          if (providerTouched.current) return;
          setProvider(preferredProvider(listed));
        })
        .catch(() => {});
    };
    load();
    const off = workspace.onStateChange((state) => {
      if (state === 'open') load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [config.browserToken, config.gatewayUrl, workspace]);

  function pushStatus(text: string): void {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === 'status' && last.text === text) return current;
      return [...current, { id: createId(), role: 'status', text }];
    });
  }

  function selectPanel(next: DevtoolsPanel): void {
    if (next === 'terminal') setTerminalMounted(true);
    setPanel((current) => (current === next ? null : next));
  }

  function closeTerminal(): void {
    setTerminalMounted(false);
    setPanel((current) => (current === 'terminal' ? null : current));
  }

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text || sending) return;
    const assistantId = createId();
    const requestId = createId();
    let assistantText = '';
    let sawEdit = false;
    let stopped = false;
    let settled = false;
    let runId: string | undefined;
    const offs: Array<() => void> = [];

    const writeAssistant = (value: string, isError = false): void => {
      assistantText = value;
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, text: value, pending: false, ...(isError ? { error: true } : {}) }
            : item,
        ),
      );
    };

    const cleanup = (): void => {
      for (const off of offs.splice(0)) off();
      if (runCleanup.current === cleanup) runCleanup.current = null;
    };

    const finish = (failure?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stopRun.current = null;
      if (stopped) writeAssistant(assistantText || 'Stopped.');
      else if (failure) writeAssistant(assistantText ? `${assistantText}\n${failure}` : failure, true);
      else writeAssistant(assistantText || 'The agent finished without text output.');
      if (!stopped && !failure && sawEdit) {
        void refreshDiffs().then((count) => {
          if (count > 0) setNotice(REVIEW_NOTICE);
        });
      }
      setSending(false);
    };

    const applyEvent = (event: UnifiedStreamEvent): void => {
      if (event.type === 'chunk' && event.payload.segment === -1) {
        const noticeText = event.payload.text?.trim();
        if (noticeText) pushStatus(noticeText);
        return;
      }
      if (event.type === 'chunk' && event.payload.text) writeAssistant(assistantText + event.payload.text);
      if (event.type === 'tool_call' && event.payload.toolName) {
        const path = toolPath(event.payload.toolArgs) ?? event.payload.filePath;
        pushStatus(activityLabel(event.payload.toolName, path));
      }
      if (event.type === 'file_edit') sawEdit = true;
      if (event.type === 'error') {
        const messageText = event.payload.error ?? 'The agent reported an error';
        writeAssistant(assistantText ? `${assistantText}\n${messageText}` : messageText, true);
      }
      if (event.type === 'done') finish();
    };

    setPrompt('');
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: createId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', pending: true },
    ]);

    offs.push(
      workspace.on('run.event', (message) => {
        if (message.requestId !== requestId && message.runId !== runId) return;
        applyEvent(message.event);
      }),
    );
    offs.push(
      workspace.on('run.finished', (message) => {
        if (message.requestId !== requestId && message.run.id !== runId) return;
        if (message.run.status === 'cancelled') stopped = true;
        if (message.run.error && !stopped) {
          finish(message.run.error.message);
          return;
        }
        finish();
      }),
    );
    runCleanup.current = cleanup;
    stopRun.current = () => {
      stopped = true;
      if (runId) workspace.send({ type: 'run.cancel', runId });
      finish();
    };

    try {
      const live = elementRef.current;
      const selectedElement = live?.isConnected ? locateElement(live) : selected ?? undefined;
      const context = await gatherContext(selectedElement, live);
      if (settled) return;
      const accepted = await workspace.request({
        type: 'run.start',
        requestId,
        provider,
        mode: 'agent',
        prompt: text,
        context,
        attachments: [],
      });
      runId = accepted.runId;
      if (stopped) workspace.send({ type: 'run.cancel', runId: accepted.runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prompt failed';
      finish(message);
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
          <button
            type="button"
            className="icon-button"
            data-action="dismiss-notice"
            aria-label="Dismiss notice"
            title="Dismiss notice"
            onClick={() => setNotice(null)}
          >
            <XIcon />
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
      {panel || terminalMounted ? (
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
              onStop={() => stopRun.current?.()}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel === 'diffs' ? (
            <DiffViewer
              workspace={workspace}
              summary={summary}
              loading={diffLoading}
              error={diffError}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {terminalMounted ? (
            <TerminalPanel workspace={workspace} hidden={panel !== 'terminal'} onClose={closeTerminal} />
          ) : null}
          {panel === 'tests' ? (
            <TestRunner workspace={workspace} projectName={config.projectName} onClose={() => setPanel(null)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

async function fetchProviderAvailability(gatewayUrl: string, token: string): Promise<ProviderStatus[]> {
  const response = await fetch(new URL('/api/v1/status', gatewayUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('providers' in body)) return [];
  const providers = (body as { providers?: unknown }).providers;
  if (!Array.isArray(providers)) return [];
  const statuses: ProviderStatus[] = [];
  for (const item of providers) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { provider?: unknown; available?: unknown };
    if (!isProvider(record.provider)) continue;
    statuses.push({ provider: record.provider, available: record.available === true });
  }
  return statuses;
}

function isProvider(value: unknown): value is ProviderType {
  return value === 'cursor' || value === 'claude' || value === 'codex' || value === 'antigravity';
}

function visibleDiffError(error: unknown): string | null {
  if (error instanceof WorkspaceError && error.code === 'disconnected') return null;
  if (error instanceof Error) return error.message;
  return 'Could not load the diff';
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

function toolPath(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const key of ['path', 'filePath', 'file_path', 'target_file']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
