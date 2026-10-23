import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GitDiffSummary, ProviderType, SelectedElement, UnifiedStreamEvent } from '@aidev/protocol';
import { gatherContext } from '../context/index.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import { DEFAULT_GATEWAY_URL, type DevtoolsConfig, type ProviderStatus } from '../types.js';
import { BottomDock } from './BottomDock.js';
import { ChatDrawer, type ChatLine } from './ChatDrawer.js';
import { CommandPalette, type PaletteItem } from './CommandPalette.js';
import { DiffViewer } from './DiffViewer.js';
import {
  eventInsideOverlay,
  isEditableTarget,
  isInspectChord,
  isPaletteChord,
  isStopChord,
} from './keyboard.js';
import { LauncherPill, type PillStatus } from './LauncherPill.js';
import {
  BOTTOM_DEFAULT,
  type BottomTab,
  type DockMode,
  type PillCorner,
  type SideTab,
  clampBottomHeight,
  clampSideWidth,
  isCompactViewport,
  isSheetViewport,
  pillOffset,
  readViewport,
  reviewDefaultWidth,
  shouldPush,
} from './layout/geometry.js';
import { applyDocumentPush, restoreDocumentPush, snapshotDocumentPush, type PushSnapshot } from './layout/push.js';
import {
  DEFAULT_AUTO_ATTACH,
  locSelector,
  loadPrefs,
  loadSession,
  savePrefs,
  saveSession,
  type AutoAttachPrefs,
} from './prefs.js';
import { SettingsModal } from './SettingsModal.js';
import { SideDock } from './SideDock.js';
import { TerminalPanel } from './Terminal.js';
import { TestRunner } from './TestRunner.js';
import { applyHostTheme, type OverlayTheme } from './theme/tokens.js';
import { ToastStack, type Toast } from './ToastStack.js';
import {
  WorkspaceClient,
  WorkspaceError,
  type WorkspaceConnection,
  type WorkspaceConnectionState,
} from './workspace-client.js';

export interface AppProps {
  config: DevtoolsConfig;
}

const TOAST_MS = 6_000;

const PROVIDER_LABELS: Array<{ id: ProviderType; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'antigravity', label: 'Antigravity' },
];

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
  const storedPrefs = useMemo(() => loadPrefs(), []);
  const storedSession = useMemo(() => loadSession(config.projectId ?? 'default'), [config.projectId]);
  const [inspecting, setInspecting] = useState(false);
  const [sideOpen, setSideOpen] = useState(storedSession.sideOpen ?? false);
  const [sideTab, setSideTab] = useState<SideTab>(storedSession.sideTab ?? 'chat');
  const [bottomOpen, setBottomOpen] = useState(storedSession.bottomOpen ?? false);
  const [bottomTab, setBottomTab] = useState<BottomTab>(storedSession.bottomTab ?? 'terminal');
  const [terminalMounted, setTerminalMounted] = useState(
    () => Boolean(storedSession.bottomOpen && storedSession.bottomTab === 'terminal'),
  );
  const [sideWidth, setSideWidth] = useState(storedPrefs.sideWidth ?? 420);
  const [bottomHeight, setBottomHeight] = useState(storedPrefs.bottomHeight ?? BOTTOM_DEFAULT);
  const [pillCorner, setPillCorner] = useState<PillCorner>(storedPrefs.pillCorner ?? 'bottom-right');
  const [theme, setTheme] = useState<OverlayTheme>(storedPrefs.theme ?? config.theme ?? 'dark');
  const [dockMode, setDockMode] = useState<DockMode>(storedPrefs.dockMode ?? config.dock ?? 'push');
  const [autoAttach, setAutoAttach] = useState<AutoAttachPrefs>(storedPrefs.autoAttach ?? { ...DEFAULT_AUTO_ATTACH });
  const [viewport, setViewport] = useState(readViewport());
  const [chatUnread, setChatUnread] = useState(false);
  const [status, setStatus] = useState<'connected' | 'idle'>('idle');
  const [connectionState, setConnectionState] = useState<WorkspaceConnectionState>('closed');
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [provider, setProvider] = useState<ProviderType>(storedPrefs.provider ?? 'cursor');
  const [availability, setAvailability] = useState<Partial<Record<ProviderType, boolean>>>({});
  const [gatewayVersion, setGatewayVersion] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const providerTouched = useRef(storedPrefs.provider != null);
  const [prompt, setPrompt] = useState(storedSession.prompt ?? '');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(storedSession.threadId ?? null);
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffCount, setDiffCount] = useState(0);
  const elementRef = useRef<Element | null>(null);
  const selectedLocRef = useRef<string | null>(storedSession.selectedLoc ?? null);
  const pickerRef = useRef<ElementPicker | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stopRun = useRef<(() => void) | null>(null);
  const runCleanup = useRef<(() => void) | null>(null);
  const pushSnapshot = useRef<PushSnapshot | null>(null);
  const skipSideFocus = useRef(true);
  const skipBottomFocus = useRef(true);
  const pendingTestRun = useRef(false);
  const sideOpenRef = useRef(sideOpen);
  const sideTabRef = useRef(sideTab);
  const inspectingRef = useRef(inspecting);
  const bottomOpenRef = useRef(bottomOpen);
  const bottomTabRef = useRef(bottomTab);
  const paletteOpenRef = useRef(paletteOpen);
  const settingsOpenRef = useRef(settingsOpen);
  const hiddenRef = useRef(hidden);
  const sendingRef = useRef(sending);
  sideOpenRef.current = sideOpen;
  sideTabRef.current = sideTab;
  inspectingRef.current = inspecting;
  bottomOpenRef.current = bottomOpen;
  bottomTabRef.current = bottomTab;
  paletteOpenRef.current = paletteOpen;
  settingsOpenRef.current = settingsOpen;
  hiddenRef.current = hidden;
  sendingRef.current = sending;

  const sheet = isSheetViewport(viewport.width);
  const compact = isCompactViewport(viewport.width);
  const pushEnabled = shouldPush(dockMode, sheet);
  const pillStatus: PillStatus = sending ? 'running' : status === 'connected' ? 'connected' : 'idle';
  const offset = pillOffset(pillCorner, sideOpen, bottomOpen, sideWidth, bottomHeight, sheet);
  const projectKey = config.projectId ?? 'default';
  const gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;

  const workspace = useMemo<WorkspaceConnection>(() => {
    if (config.workspace) return config.workspace;
    if (!config.projectId || !config.browserToken) return disconnectedWorkspace;
    return new WorkspaceClient({
      gatewayUrl,
      projectId: config.projectId,
      browserToken: config.browserToken,
    });
  }, [config.browserToken, config.projectId, config.workspace, gatewayUrl]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const known = Object.keys(availability).length > 0;
    const providers = PROVIDER_LABELS.filter((item) => !known || availability[item.id] === true).map((item) => ({
      id: `provider:${item.id}`,
      group: 'Provider' as const,
      label: `Switch to ${item.label}`,
    }));
    const actions: PaletteItem[] = [
      { id: 'inspect', group: 'Actions', label: 'Inspect element' },
      { id: 'new-chat', group: 'Actions', label: 'New chat' },
      { id: 'review', group: 'Actions', label: 'Open Review' },
      { id: 'run-tests', group: 'Actions', label: 'Run tests' },
      { id: 'terminal', group: 'Actions', label: 'Open terminal' },
      { id: 'toggle-theme', group: 'Actions', label: 'Toggle theme' },
      { id: 'settings', group: 'Actions', label: 'Settings' },
      { id: 'hide', group: 'Actions', label: 'Hide toolbar until reload' },
    ];
    return [...actions, ...providers];
  }, [availability]);

  const refreshDiffs = useCallback(async (): Promise<number> => {
    setDiffLoading(true);
    try {
      const result = await workspace.request({ type: 'git.diff' });
      setSummary(result.summary);
      setDiffCount(result.summary.files.length);
      setDiffError(null);
      if (result.summary.files.length === 0) dismissToastsMatching('Edited');
      return result.summary.files.length;
    } catch (error) {
      const message = visibleDiffError(error);
      setDiffError(message);
      return 0;
    } finally {
      setDiffLoading(false);
    }
  }, [workspace]);

  function overlayHost(): Element | null {
    const root = shellRef.current?.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function applyTheme(next: OverlayTheme): void {
    setTheme(next);
    const host = overlayHost();
    if (host instanceof HTMLElement) applyHostTheme(host, next);
  }

  function pushToast(toast: Omit<Toast, 'id'> & { id?: string }): void {
    const id = toast.id ?? createId();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, TOAST_MS);
  }

  function dismissToastsMatching(needle: string): void {
    setToasts((current) => current.filter((item) => !item.text.includes(needle)));
  }

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
        selectedLocRef.current = element.getAttribute('data-loc');
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
      if (message.summary.files.length === 0) dismissToastsMatching('Edited');
    });
  }, [refreshDiffs, workspace]);

  useLayoutEffect(() => {
    const apply = (state: WorkspaceConnectionState): void => {
      setConnectionState(state);
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
      void fetchGatewayStatus(gatewayUrl, token)
        .then((info) => {
          if (cancelled) return;
          setGatewayVersion(info.version);
          if (info.providers.length === 0) return;
          setAvailability(availabilityMap(info.providers));
          if (providerTouched.current) return;
          setProvider(preferredProvider(info.providers));
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
  }, [config.browserToken, gatewayUrl, workspace]);

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
    const host = overlayHost();
    if (host instanceof HTMLElement) applyHostTheme(host, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system' || typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      const host = overlayHost();
      if (host instanceof HTMLElement) applyHostTheme(host, 'system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

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

  useLayoutEffect(() => {
    if (!pendingTestRun.current || !bottomOpen || bottomTab !== 'tests') return;
    pendingTestRun.current = false;
    const button = shellRef.current?.querySelector('[data-action="run-tests"]');
    if (button instanceof HTMLElement) button.click();
  }, [bottomOpen, bottomTab]);

  useLayoutEffect(() => {
    const loc = selectedLocRef.current;
    if (!loc || selected) return;
    try {
      const element = document.querySelector(locSelector(loc));
      if (!(element instanceof Element)) return;
      elementRef.current = element;
      setSelected(locateElement(element));
    } catch {
      selectedLocRef.current = null;
    }
  }, [selected]);

  useEffect(() => {
    savePrefs({
      theme,
      dockMode,
      provider,
      autoAttach,
      pillCorner,
      sideWidth,
      bottomHeight,
    });
  }, [theme, dockMode, provider, autoAttach, pillCorner, sideWidth, bottomHeight]);

  useEffect(() => {
    saveSession(projectKey, {
      sideOpen,
      sideTab,
      bottomOpen,
      bottomTab,
      prompt,
      threadId,
      selectedLoc: selectedLocRef.current,
    });
  }, [projectKey, sideOpen, sideTab, bottomOpen, bottomTab, prompt, threadId, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (hiddenRef.current) return;
      const host = overlayHost();
      if (isPaletteChord(event)) {
        if (!eventInsideOverlay(event, host) && isEditableTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (settingsOpenRef.current) setSettingsOpen(false);
        setPaletteOpen((value) => !value);
        return;
      }
      if (isInspectChord(event)) {
        event.preventDefault();
        setInspecting((value) => !value);
        return;
      }
      if (isStopChord(event)) {
        if (!sendingRef.current) return;
        event.preventDefault();
        stopRun.current?.();
        return;
      }
      if (event.key !== 'Escape') return;
      if (paletteOpenRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPaletteOpen(false);
        return;
      }
      if (settingsOpenRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSettingsOpen(false);
        return;
      }
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
    if (tab === 'diffs') setSideWidth((current) => Math.max(current, reviewDefaultWidth(viewport.width)));
    setSideTab(tab);
    setSideOpen(true);
    if (tab === 'chat') setChatUnread(false);
    if (tab === 'diffs') dismissToastsMatching('Edited');
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
    setBottomHeight((current) => clampBottomHeight(current, viewport.height));
    setBottomTab(tab);
    setBottomOpen(true);
  }

  function closeBottom(disposeTerminal: boolean): void {
    const action = bottomTabRef.current === 'terminal' ? 'terminal' : 'tests';
    if (disposeTerminal) setTerminalMounted(false);
    setBottomOpen(false);
    queueMicrotask(() => focusAction(action));
  }

  function openSettings(): void {
    setPaletteOpen(false);
    setSettingsOpen(true);
  }

  function hideToolbar(): void {
    setPaletteOpen(false);
    setSettingsOpen(false);
    setInspecting(false);
    setSideOpen(false);
    setBottomOpen(false);
    setHidden(true);
  }

  function newChat(): void {
    setMessages([]);
    setPrompt('');
    setThreadId(null);
    setChatUnread(false);
    setSideTab('chat');
    setSideOpen(true);
  }

  function executePalette(id: string): void {
    setPaletteOpen(false);
    if (id === 'inspect') {
      setInspecting((value) => !value);
      return;
    }
    if (id === 'new-chat') {
      newChat();
      return;
    }
    if (id === 'review') {
      openSide('diffs', true);
      return;
    }
    if (id === 'run-tests') {
      pendingTestRun.current = true;
      openBottom('tests', true);
      return;
    }
    if (id === 'terminal') {
      openBottom('terminal', true);
      return;
    }
    if (id === 'toggle-theme') {
      applyTheme(theme === 'light' ? 'dark' : 'light');
      return;
    }
    if (id === 'settings') {
      openSettings();
      return;
    }
    if (id === 'hide') {
      hideToolbar();
      return;
    }
    if (id.startsWith('provider:')) {
      const next = id.slice('provider:'.length);
      if (next === 'cursor' || next === 'claude' || next === 'codex' || next === 'antigravity') {
        providerTouched.current = true;
        setProvider(next);
      }
    }
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
    let editedCount = 0;
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
      if (failure) {
        pushToast({ text: failure, tone: 'error' });
      } else if (!stopped && sawEdit && !(sideOpenRef.current && sideTabRef.current === 'diffs')) {
        void refreshDiffs().then((count) => {
          const files = count || editedCount || 1;
          pushToast({
            text: `Edited ${files} file${files === 1 ? '' : 's'}`,
            actions: [
              {
                label: 'Review',
                action: 'review-diffs',
                onClick: () => {
                  dismissToastsMatching('Edited');
                  openSide('diffs', true);
                },
              },
            ],
          });
        });
      } else if (!stopped && sawEdit) {
        void refreshDiffs();
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
      if (event.type === 'file_edit') {
        sawEdit = true;
        editedCount += 1;
      }
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
      const context = await gatherContext(selectedElement, live, {
        screenshot: autoAttach.screenshot,
        consoleErrors: autoAttach.consoleErrors,
        failedRequests: autoAttach.failedRequests,
      });
      if (settled) return;
      const accepted = await workspace.request({
        type: 'run.start',
        requestId,
        ...(threadId ? { threadId } : {}),
        provider,
        mode: 'agent',
        prompt: text,
        context,
        attachments: [],
      });
      runId = accepted.runId;
      if (accepted.threadId) setThreadId(accepted.threadId);
      if (stopped) workspace.send({ type: 'run.cancel', runId: accepted.runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prompt failed';
      finish(message);
    }
  }

  if (hidden) return <div className="dock" ref={shellRef} hidden />;

  return (
    <div className="dock" ref={shellRef}>
      {inspecting ? (
        <div className="inspect-banner" role="status">
          Click an element to attach it. Press Esc to cancel.
        </div>
      ) : null}
      <ToastStack
        toasts={toasts}
        corner={pillCorner}
        offset={offset}
        onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
      />
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
          tab={sideTab}
          onTab={(next) => openSide(next, true)}
          onResize={(width) => setSideWidth(clampSideWidth(width))}
          onClose={closeSide}
          onSettings={openSettings}
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
                selectedLocRef.current = null;
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
      {paletteOpen ? (
        <CommandPalette items={paletteItems} onExecute={executePalette} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          theme={theme}
          dockMode={dockMode}
          provider={provider}
          autoAttach={autoAttach}
          availability={availability}
          gatewayUrl={gatewayUrl}
          connectionState={connectionState}
          gatewayVersion={gatewayVersion}
          onTheme={applyTheme}
          onDockMode={setDockMode}
          onProvider={(next) => {
            providerTouched.current = true;
            setProvider(next);
          }}
          onAutoAttach={setAutoAttach}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

async function fetchGatewayStatus(
  gatewayUrl: string,
  token: string,
): Promise<{ providers: ProviderStatus[]; version: string | null }> {
  const response = await fetch(new URL('/api/v1/status', gatewayUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { providers: [], version: null };
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') return { providers: [], version: null };
  const record = body as { providers?: unknown; version?: unknown };
  const version = typeof record.version === 'string' ? record.version : null;
  if (!Array.isArray(record.providers)) return { providers: [], version };
  const statuses: ProviderStatus[] = [];
  for (const item of record.providers) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { provider?: unknown; available?: unknown };
    if (!isProvider(entry.provider)) continue;
    statuses.push({ provider: entry.provider, available: entry.available === true });
  }
  return { providers: statuses, version };
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
