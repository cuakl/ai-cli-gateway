import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GitDiffSummary, ProviderType, SelectedElement, UnifiedStreamEvent } from '@aidev/protocol';
import { gatherContext } from '../context/index.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import { DEFAULT_GATEWAY_URL, type DevtoolsConfig, type ProviderStatus } from '../types.js';
import { BottomDock } from './BottomDock.js';
import { ChatDrawer, type ChatLine } from './ChatDrawer.js';
import { DiffViewer } from './DiffViewer.js';
import { XIcon } from './icons.js';
import { LauncherPill, type PillStatus } from './LauncherPill.js';
import {
  BOTTOM_DEFAULT,
  PILL_HEIGHT,
  SIDE_CHAT_DEFAULT,
  type BottomTab,
  type DockMode,
  type PillCorner,
  type SideTab,
  clampBottomHeight,
  clampSideWidth,
  defaultSideWidth,
  isCompactViewport,
  isSheetViewport,
  pillOffset,
  readViewport,
  reviewDefaultWidth,
  shouldPush,
} from './layout/geometry.js';
import { applyDocumentPush, restoreDocumentPush, snapshotDocumentPush, type PushSnapshot } from './layout/push.js';
import { SideDock } from './SideDock.js';
import { TerminalPanel } from './Terminal.js';
import { TestRunner } from './TestRunner.js';
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
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [sideWidth, setSideWidth] = useState(SIDE_CHAT_DEFAULT);
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_DEFAULT);
  const [pillCorner, setPillCorner] = useState<PillCorner>('bottom-right');
  const [viewport, setViewport] = useState(readViewport());
  const [chatUnread, setChatUnread] = useState(false);
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
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stopRun = useRef<(() => void) | null>(null);
  const runCleanup = useRef<(() => void) | null>(null);
  const pushSnapshot = useRef<PushSnapshot | null>(null);
  const skipSideFocus = useRef(true);
  const skipBottomFocus = useRef(true);
  const sideOpenRef = useRef(sideOpen);
  const sideTabRef = useRef(sideTab);
  const inspectingRef = useRef(inspecting);
  const bottomOpenRef = useRef(bottomOpen);
  const bottomTabRef = useRef(bottomTab);
  sideOpenRef.current = sideOpen;
  sideTabRef.current = sideTab;
  inspectingRef.current = inspecting;
  bottomOpenRef.current = bottomOpen;
  bottomTabRef.current = bottomTab;

  const dockMode: DockMode = config.dock ?? 'push';
  const sheet = isSheetViewport(viewport.width);
  const compact = isCompactViewport(viewport.width);
  const pushEnabled = shouldPush(dockMode, sheet);
  const pillStatus: PillStatus = sending ? 'running' : status === 'connected' ? 'connected' : 'idle';
  const offset = pillOffset(pillCorner, sideOpen, bottomOpen, sideWidth, bottomHeight, sheet);

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
      if (result.summary.files.length === 0) setNotice(null);
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

  useEffect(() => {
    const onResize = (): void => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const picker = new ElementPicker({
      onSelect(element) {
        elementRef.current = element;
        setSelected(locateElement(element));
        setInspecting(false);
        setSideTab('chat');
        setSideOpen(true);
        setChatUnread(false);
      },
      onCancel() {
        setInspecting(false);
        focusAction('inspect');
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
    const node = shellRef.current?.querySelector('.messages');
    if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight;
  }, [messages, sideTab, sideOpen]);

  useLayoutEffect(() => {
    void refreshDiffs();
    return workspace.on('git.changed', (message) => {
      setSummary(message.summary);
      setDiffCount(message.summary.files.length);
      setDiffError(null);
      setDiffLoading(false);
      if (message.summary.files.length === 0) setNotice(null);
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

  useLayoutEffect(() => {
    if (!pushSnapshot.current) pushSnapshot.current = snapshotDocumentPush();
    applyDocumentPush(
      document.documentElement,
      pushSnapshot.current,
      pushEnabled && sideOpen ? sideWidth : 0,
      pushEnabled && bottomOpen ? bottomHeight : 0,
      pushEnabled,
    );
  }, [pushEnabled, sideOpen, bottomOpen, sideWidth, bottomHeight]);

  useEffect(() => {
    return () => {
      if (pushSnapshot.current) restoreDocumentPush(document.documentElement, pushSnapshot.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (skipSideFocus.current) {
      skipSideFocus.current = false;
      return;
    }
    if (!sideOpen) return;
    const root = shellRef.current;
    if (!root) return;
    if (sideTab === 'chat') {
      const textarea = root.querySelector('textarea');
      if (textarea instanceof HTMLElement) textarea.focus();
      return;
    }
    const file = root.querySelector('[data-file], [aria-label="Modified files"]');
    if (file instanceof HTMLElement) file.focus();
  }, [sideOpen, sideTab]);

  useLayoutEffect(() => {
    if (skipBottomFocus.current) {
      skipBottomFocus.current = false;
      return;
    }
    if (!bottomOpen) return;
    const root = shellRef.current;
    if (!root) return;
    if (bottomTab === 'terminal') {
      const host = root.querySelector('.terminal-host');
      if (host instanceof HTMLElement) host.focus();
      return;
    }
    const run = root.querySelector('[data-action="run-tests"]');
    if (run instanceof HTMLElement) run.focus();
  }, [bottomOpen, bottomTab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (inspectingRef.current) return;
      if (bottomOpenRef.current) {
        event.preventDefault();
        closeBottom(false);
        return;
      }
      if (sideOpenRef.current) {
        event.preventDefault();
        closeSide();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  function focusAction(action: string): void {
    const button = shellRef.current?.querySelector(`[data-action="${action}"]`);
    if (button instanceof HTMLElement) button.focus();
  }

  function openSide(tab: SideTab, fromInspect = false): void {
    if (sheet && bottomOpen) setBottomOpen(false);
    if (sideOpen && sideTab === tab && !fromInspect) {
      closeSide();
      return;
    }
    if (!sideOpen) setSideWidth(defaultSideWidth(tab, viewport.width));
    else if (tab === 'diffs') setSideWidth((current) => Math.max(current, reviewDefaultWidth(viewport.width)));
    setSideTab(tab);
    setSideOpen(true);
    if (tab === 'chat') setChatUnread(false);
    if (tab === 'diffs') setNotice(null);
  }

  function closeSide(): void {
    const action = sideTabRef.current === 'chat' ? 'chat' : 'diffs';
    setSideOpen(false);
    queueMicrotask(() => focusAction(action));
  }

  function openBottom(tab: BottomTab, force = false): void {
    if (sheet && sideOpen) setSideOpen(false);
    if (tab === 'terminal') setTerminalMounted(true);
    if (bottomOpen && bottomTab === tab && !force) {
      setBottomOpen(false);
      queueMicrotask(() => focusAction(tab));
      return;
    }
    if (!bottomOpen) setBottomHeight(clampBottomHeight(BOTTOM_DEFAULT, viewport.height));
    setBottomTab(tab);
    setBottomOpen(true);
  }

  function closeBottom(disposeTerminal: boolean): void {
    const action = bottomTabRef.current === 'terminal' ? 'terminal' : 'tests';
    if (disposeTerminal) setTerminalMounted(false);
    setBottomOpen(false);
    queueMicrotask(() => focusAction(action));
  }

  function pushStatus(text: string): void {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === 'status' && last.text === text) return current;
      return [...current, { id: createId(), role: 'status', text }];
    });
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
      if (!(sideOpenRef.current && sideTabRef.current === 'chat')) setChatUnread(true);
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
    <div className="dock" ref={shellRef}>
      {inspecting ? (
        <div className="inspect-banner" role="status">
          Click an element to attach it. Press Esc to cancel.
        </div>
      ) : null}
      {notice ? (
        <div className="notice" data-corner={pillCorner} role="status" style={toastStyle(pillCorner, offset)}>
          <span>{notice}</span>
          <button
            type="button"
            data-action="review-diffs"
            onClick={() => {
              setNotice(null);
              openSide('diffs');
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
      <LauncherPill
        inspecting={inspecting}
        sideOpen={sideOpen}
        sideTab={sideTab}
        bottomOpen={bottomOpen}
        bottomTab={bottomTab}
        diffCount={diffCount}
        chatUnread={chatUnread}
        status={pillStatus}
        compact={compact}
        corner={pillCorner}
        insetInline={offset.inline}
        insetBlock={offset.block}
        onMove={setPillCorner}
        onToggleInspect={() => setInspecting((value) => !value)}
        onSelectChat={() => openSide('chat')}
        onSelectReview={() => openSide('diffs')}
        onSelectTerminal={() => openBottom('terminal')}
        onSelectTests={() => openBottom('tests')}
      />
      {sideOpen ? (
        <SideDock
          open={sideOpen}
          sheet={sheet}
          width={sideWidth}
          bottomOffset={bottomOpen && !sheet ? bottomHeight : 0}
          tab={sideTab}
          onTab={(next) => openSide(next, true)}
          onResize={(width) => setSideWidth(clampSideWidth(width))}
          onClose={closeSide}
        >
          {sideTab === 'chat' ? (
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
            />
          ) : (
            <DiffViewer workspace={workspace} summary={summary} loading={diffLoading} error={diffError} />
          )}
        </SideDock>
      ) : null}
      {bottomOpen || terminalMounted ? (
        <BottomDock
          open={bottomOpen}
          sheet={sheet}
          height={bottomHeight}
          sideOffset={sideOpen && !sheet ? sideWidth : 0}
          viewportHeight={viewport.height}
          tab={bottomTab}
          onTab={(next) => openBottom(next, true)}
          onResize={(height) => setBottomHeight(clampBottomHeight(height, viewport.height))}
          onClose={() => closeBottom(bottomTab === 'terminal')}
        >
          {terminalMounted ? (
            <TerminalPanel workspace={workspace} hidden={!bottomOpen || bottomTab !== 'terminal'} />
          ) : null}
          {bottomOpen && bottomTab === 'tests' ? (
            <TestRunner workspace={workspace} projectName={config.projectName} />
          ) : null}
        </BottomDock>
      ) : null}
    </div>
  );
}

function toastStyle(
  corner: PillCorner,
  offset: { inline: number; block: number },
): Record<string, string> {
  const edge = `${offset.block + PILL_HEIGHT + 8}px`;
  const inset = `${offset.inline}px`;
  if (corner === 'bottom-right') return { right: inset, bottom: edge, left: 'auto', top: 'auto' };
  if (corner === 'bottom-left') return { left: inset, bottom: edge, right: 'auto', top: 'auto' };
  if (corner === 'top-right') return { right: inset, top: edge, left: 'auto', bottom: 'auto' };
  return { left: inset, top: edge, right: 'auto', bottom: 'auto' };
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
