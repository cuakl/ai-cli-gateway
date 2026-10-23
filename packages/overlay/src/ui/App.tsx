import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type {
  FailedNetworkRequest,
  FrontendError,
  GitDiffSummary,
  ProviderCapabilities,
  ProviderType,
  RunMode,
  SelectedElement,
  StreamEventPayload,
  UnifiedStreamEvent,
} from '@aidev/protocol';
import { ProviderCapabilitiesSchema } from '@aidev/protocol';
import type { ConsoleEntry } from '../context/entries.js';
import {
  CONTEXT_MAX_AGE_MS,
  gatherContext,
  getErrorCountSinceRun,
  getRecentErrors,
  getViteError,
  markRunStart,
  setViteFixHandler,
  subscribeContext,
} from '../context/index.js';
import { getRecentFailedNetworkRequests } from '../context/network.js';
import {
  CaptureError,
  captureElementOrThrow,
  captureRegion,
  captureViewport,
  downscaleDataUrl,
  type ScreenshotMode,
} from '../context/screenshot.js';
import { SelectionBadges } from '../inspector/badges.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import { RegionPicker } from '../inspector/region.js';
import { appendSelection, breadcrumbAncestors, breadcrumbLabels, MAX_SELECTIONS } from '../inspector/walk.js';
import { DEFAULT_GATEWAY_URL, type DevtoolsConfig, type ProviderStatus } from '../types.js';
import { BottomDock } from './BottomDock.js';
import { ChatDrawer } from './ChatDrawer.js';
import { chipFromConsoleEntry, composerSuggestions, deriveContextChips } from './chat/chips.js';
import type { HistoryRow } from './chat/HistoryList.js';
import type { ProviderOption } from './chat/Composer.js';
import {
  applyEvent,
  emptyChatState,
  hydrateFromThread,
  runTouchedFiles,
  startTurn,
  type ChatState,
  type ContextChip,
  type ContextChipKind,
  type NoticeItem,
} from './chat/model.js';
import { CommandPalette, type PaletteItem } from './CommandPalette.js';
import { ConsolePanel } from './ConsolePanel.js';
import { DiffViewer, type ReviewScope } from './DiffViewer.js';
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
  type DiffViewMode,
  type OverlaySession,
} from './prefs.js';
import { SettingsModal } from './SettingsModal.js';
import { SideDock } from './SideDock.js';
import { TerminalPanel } from './Terminal.js';
import { TestRunner } from './TestRunner.js';
import { applyHostTheme, type OverlayTheme } from './theme/tokens.js';
import { AnnotateLayer } from './AnnotateLayer.js';
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
  const [selections, setSelections] = useState<SelectedElement[]>([]);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderType>(storedPrefs.provider ?? 'cursor');
  const [model, setModel] = useState<string | null>(storedPrefs.model ?? null);
  const [mode, setMode] = useState<RunMode>(storedPrefs.mode === 'ask' ? 'ask' : 'agent');
  const [availability, setAvailability] = useState<Partial<Record<ProviderType, boolean>>>({});
  const [capabilities, setCapabilities] = useState<ProviderCapabilities[]>([]);
  const [excludedKinds, setExcludedKinds] = useState<ContextChipKind[]>([]);
  const [pinnedChips, setPinnedChips] = useState<ContextChip[]>([]);
  const [pinnedErrors, setPinnedErrors] = useState<FrontendError[]>([]);
  const [pinnedRequests, setPinnedRequests] = useState<FailedNetworkRequest[]>([]);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [contextTick, setContextTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [gatewayVersion, setGatewayVersion] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const providerTouched = useRef(storedPrefs.provider != null);
  const [prompt, setPrompt] = useState(storedSession.prompt ?? '');
  const [chat, dispatchChat] = useReducer(reduceChat, emptyChatState());
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(storedSession.threadId ?? null);
  const [runId, setRunId] = useState<string | null>(storedSession.runId ?? null);
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffCount, setDiffCount] = useState(0);
  const [diffView, setDiffView] = useState<DiffViewMode>(storedPrefs.diffView ?? 'unified');
  const [reviewScope, setReviewScope] = useState<ReviewScope>('all');
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [liveRunFiles, setLiveRunFiles] = useState<string[]>([]);
  const elementRef = useRef<Element | null>(null);
  const elementRefs = useRef<Element[]>([]);
  const selectedLocRef = useRef<string | null>(storedSession.selectedLoc ?? null);
  const pickerRef = useRef<ElementPicker | null>(null);
  const badgesRef = useRef<SelectionBadges | null>(null);
  const regionRef = useRef<RegionPicker | null>(null);
  const applyPickRef = useRef<(element: Element, shift: boolean) => void>(() => undefined);
  const openEditorRef = useRef<(element: Element) => void>(() => undefined);
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
  const annotatingRef = useRef(false);
  const bottomOpenRef = useRef(bottomOpen);
  const bottomTabRef = useRef(bottomTab);
  const paletteOpenRef = useRef(paletteOpen);
  const settingsOpenRef = useRef(settingsOpen);
  const hiddenRef = useRef(hidden);
  const sendingRef = useRef(sending);
  const chatRef = useRef(chat);
  const undoConflictRunId = useRef<string | null>(null);
  const composerEscape = useRef<() => boolean>(() => false);
  const hydratedThreadId = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(storedSession.threadId ?? null);
  const runIdRef = useRef<string | null>(storedSession.runId ?? null);
  const promptRef = useRef(storedSession.prompt ?? '');
  const seenEventIds = useRef(new Set<string>());
  const attachedRunId = useRef<string | null>(null);
  sideOpenRef.current = sideOpen;
  sideTabRef.current = sideTab;
  inspectingRef.current = inspecting;
  annotatingRef.current = Boolean(annotating);
  bottomOpenRef.current = bottomOpen;
  bottomTabRef.current = bottomTab;
  paletteOpenRef.current = paletteOpen;
  settingsOpenRef.current = settingsOpen;
  hiddenRef.current = hidden;
  sendingRef.current = sending;
  chatRef.current = chat;
  threadIdRef.current = threadId;
  runIdRef.current = runId;
  promptRef.current = prompt;

  const sheet = isSheetViewport(viewport.width);
  const compact = isCompactViewport(viewport.width);
  const pushEnabled = shouldPush(dockMode, sheet);
  const pillStatus: PillStatus = sending ? 'running' : status === 'connected' ? 'connected' : 'idle';
  const offset = pillOffset(pillCorner, sideOpen, bottomOpen, sideWidth, bottomHeight, sheet);
  const projectKey = config.projectId ?? 'default';
  const gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;

  function rememberSession(patch: Partial<OverlaySession> = {}): void {
    if (patch.prompt !== undefined) promptRef.current = patch.prompt;
    if (patch.threadId !== undefined) threadIdRef.current = patch.threadId;
    if (patch.runId !== undefined) runIdRef.current = patch.runId;
    saveSession(projectKey, {
      sideOpen: sideOpenRef.current,
      sideTab: sideTabRef.current,
      bottomOpen: bottomOpenRef.current,
      bottomTab: bottomTabRef.current,
      prompt: promptRef.current,
      threadId: threadIdRef.current,
      runId: runIdRef.current,
      selectedLoc: selectedLocRef.current,
    });
  }
  const providerOptions = useMemo(
    () => buildProviderOptions(capabilities, availability),
    [capabilities, availability],
  );
  const errorCount = getErrorCountSinceRun();
  const chips = useMemo(() => {
    const derived = deriveContextChips({
      selected,
      selections,
      screenshotUrl,
      screenshotError,
      breadcrumbs: elementRefs.current.map((node) => breadcrumbLabels(node)),
      errors: getRecentErrors(),
      failedRequests: getRecentFailedNetworkRequests(CONTEXT_MAX_AGE_MS),
      autoAttach,
      excluded: new Set(excludedKinds),
      viteError: getViteError()?.message ?? null,
    });
    const pinnedKinds = new Set(pinnedChips.map((chip) => chip.kind));
    return [...derived.filter((chip) => !pinnedKinds.has(chip.kind)), ...pinnedChips];
  }, [selected, selections, screenshotUrl, screenshotError, autoAttach, excludedKinds, contextTick, pinnedChips]);
  const suggestions = useMemo(() => {
    if (chat.items.length > 0 || threadId) return [];
    return composerSuggestions({ selected, consoleErrorCount: getRecentErrors().length });
  }, [chat.items.length, threadId, selected, contextTick]);
  const reviewFiles = useMemo(() => {
    const fromChat = runTouchedFiles(chat, reviewRunId);
    if (fromChat.length > 0) return fromChat;
    if (liveRunFiles.length > 0) return liveRunFiles;
    return runTouchedFiles(chat, null);
  }, [chat, reviewRunId, liveRunFiles]);
  const suggestedBranch = useMemo(
    () => `aidev/${slugBranch(lastUserText(chat) ?? 'change')}`,
    [chat],
  );

  const workspace = useMemo<WorkspaceConnection>(() => {
    if (config.workspace) return config.workspace;
    if (!config.projectId || !config.browserToken) return disconnectedWorkspace;
    return new WorkspaceClient({
      gatewayUrl,
      projectId: config.projectId,
      browserToken: config.browserToken,
    });
  }, [config.browserToken, config.projectId, config.workspace, gatewayUrl]);

  function attachActiveRun(gatewayRunId: string): void {
    if (attachedRunId.current === gatewayRunId) return;
    attachedRunId.current = gatewayRunId;
    const requestId = createId();
    setSending(true);
    sendingRef.current = true;
    const offs: Array<() => void> = [];
    const cleanup = (): void => {
      for (const off of offs.splice(0)) off();
      if (runCleanup.current === cleanup) runCleanup.current = null;
    };
    offs.push(
      workspace.on('run.event', (message) => {
        if (message.requestId !== requestId && message.runId !== gatewayRunId) return;
        if (seenEventIds.current.has(message.event.id)) return;
        seenEventIds.current.add(message.event.id);
        applyRunEvent(gatewayRunId, gatewayRunId, message.event);
      }),
    );
    offs.push(
      workspace.on('run.finished', (message) => {
        if (message.requestId !== requestId && message.run.id !== gatewayRunId) return;
        cleanup();
        attachedRunId.current = null;
        setSending(false);
        setRunId(null);
        rememberSession({ runId: null });
      }),
    );
    runCleanup.current = cleanup;
    stopRun.current = () => {
      workspace.send({ type: 'run.cancel', runId: gatewayRunId });
    };
    workspace.send({ type: 'run.attach', runId: gatewayRunId, requestId });
  }

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
      { id: 'console', group: 'Actions', label: 'Open console' },
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
      onSelect(element, extras) {
        applyPickRef.current(element, extras.shift);
      },
      onCancel() {
        setInspecting(false);
        focusAction('inspect');
      },
      onOpenEditor(element) {
        openEditorRef.current(element);
      },
    });
    pickerRef.current = picker;
    const badges = new SelectionBadges();
    badgesRef.current = badges;
    return () => {
      picker.stop();
      pickerRef.current = null;
      badges.stop();
      badgesRef.current = null;
      regionRef.current?.stop();
      regionRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (inspecting) picker.start();
    else picker.stop();
  }, [inspecting]);

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
          setCapabilities(info.capabilities);
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
    if (bottomTab === 'console') {
      const filter = root.querySelector('[data-action="console-filter-all"]');
      if (filter instanceof HTMLElement) filter.focus();
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
      elementRefs.current = [element];
      const located = locateElement(element);
      setSelected(located);
      setSelections([located]);
    } catch {
      selectedLocRef.current = null;
    }
  }, [selected]);

  useEffect(() => subscribeContext(() => setContextTick((value) => value + 1)), []);

  useEffect(() => {
    setViteFixHandler((error) => {
      fixWithAi({
        id: `err:vite:${error.timestamp}:${error.message}`,
        filter: 'vite',
        timestamp: error.timestamp,
        message: error.message,
        stack: error.stack,
        fixable: true,
        error,
      });
    });
    return () => setViteFixHandler(null);
  }, []);

  useEffect(() => {
    setExcludedKinds((current) => current.filter((kind) => kind !== 'selection' && kind !== 'screenshot'));
  }, [selected, selections]);

  useEffect(() => {
    if (!autoAttach.screenshot) {
      setScreenshotUrl(null);
      setScreenshotError(null);
      return;
    }
    const element = elementRefs.current[elementRefs.current.length - 1] ?? elementRef.current;
    if (!element?.isConnected || selections.length === 0) {
      setScreenshotUrl(null);
      return;
    }
    let cancelled = false;
    void captureElementOrThrow(element)
      .then((url) => {
        if (cancelled) return;
        setScreenshotError(null);
        setScreenshotUrl(url);
      })
      .catch((error) => {
        if (cancelled) return;
        setScreenshotUrl(null);
        setScreenshotError(error instanceof CaptureError ? error.message : 'Screenshot capture failed');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, selections, autoAttach.screenshot]);

  useEffect(() => {
    const badges = badgesRef.current;
    if (!badges) return;
    if (sideOpen && sideTab === 'chat' && selections.length > 0) {
      badges.set(elementRefs.current);
    } else {
      badges.set([]);
    }
  }, [selections, sideOpen, sideTab, contextTick]);

  useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void workspace
      .request({ type: 'thread.list' })
      .then((listed) => {
        if (cancelled) return;
        setHistoryRows(listed.threads.map((thread) => ({ thread, runCount: thread.runCount })));
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Could not load history');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, workspace]);

  useEffect(() => {
    if (!threadId || workspace.state !== 'open') return;
    if (hydratedThreadId.current === threadId) return;
    if (chatRef.current.items.length > 0) {
      hydratedThreadId.current = threadId;
      return;
    }
    let cancelled = false;
    void workspace
      .request({ type: 'thread.get', threadId })
      .then((result) => {
        if (cancelled) return;
        hydratedThreadId.current = result.thread.id;
        dispatchChat({ type: 'hydrate', state: hydrateFromThread(result.runs, result.events) });
        for (const entry of result.events) seenEventIds.current.add(entry.event.id);
        const live = result.runs.filter((item) => item.status === 'running' || item.status === 'queued');
        const active =
          (runIdRef.current ? live.find((item) => item.id === runIdRef.current) : undefined) ?? live.at(-1);
        if (active) {
          setRunId(active.id);
          rememberSession({ runId: active.id, threadId: result.thread.id });
          attachActiveRun(active.id);
        } else if (runIdRef.current) {
          setRunId(null);
          rememberSession({ runId: null });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof WorkspaceError && error.code === 'not_found') {
          hydratedThreadId.current = null;
          setThreadId(null);
          setRunId(null);
          rememberSession({ threadId: null, runId: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, workspace, connectionState]);

  useEffect(() => {
    savePrefs({
      theme,
      dockMode,
      provider,
      model,
      mode,
      autoAttach,
      pillCorner,
      sideWidth,
      bottomHeight,
      diffView,
    });
  }, [theme, dockMode, provider, model, mode, autoAttach, pillCorner, sideWidth, bottomHeight, diffView]);

  useEffect(() => {
    saveSession(projectKey, {
      sideOpen,
      sideTab,
      bottomOpen,
      bottomTab,
      prompt,
      threadId,
      runId,
      selectedLoc: selectedLocRef.current,
    });
  }, [projectKey, sideOpen, sideTab, bottomOpen, bottomTab, prompt, threadId, runId, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (hiddenRef.current) return;
      const host = overlayHost();
      if (isPaletteChord(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (settingsOpenRef.current) setSettingsOpen(false);
        setPaletteOpen((value) => !value);
        return;
      }
      if (!eventInsideOverlay(event, host) && isEditableTarget(event.target)) return;
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
      if (composerEscape.current()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (annotatingRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setAnnotating(null);
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
    const action = bottomTabRef.current;
    if (disposeTerminal) setTerminalMounted(false);
    setBottomOpen(false);
    queueMicrotask(() => focusAction(action));
  }

  function applyPick(element: Element, shift: boolean): void {
    const located = locateElement(element);
    if (shift) {
      const nextEls = appendSelection(elementRefs.current, element, MAX_SELECTIONS);
      if (nextEls.length === elementRefs.current.length) return;
      elementRefs.current = nextEls;
      elementRef.current = nextEls[0] ?? element;
      selectedLocRef.current = (nextEls[0] ?? element).getAttribute('data-loc');
      const next = nextEls.map((node, index) =>
        node === element ? located : selections[index] ?? locateElement(node),
      );
      setSelections(next);
      setSelected(next[0] ?? located);
    } else {
      elementRef.current = element;
      elementRefs.current = [element];
      selectedLocRef.current = element.getAttribute('data-loc');
      setSelected(located);
      setSelections([located]);
      setInspecting(false);
    }
    setSideTab('chat');
    setSideOpen(true);
    setChatUnread(false);
  }
  applyPickRef.current = applyPick;

  async function openElementInEditor(element: Element): Promise<void> {
    const located = locateElement(element);
    const loc = located.sourceLocation;
    if (!loc?.fileName) {
      pushToast({ text: 'No source location for that element', tone: 'error' });
      return;
    }
    try {
      await workspace.request({
        type: 'editor.open',
        file: loc.fileName,
        line: loc.lineNumber,
        column: loc.columnNumber,
      });
    } catch (error) {
      pushToast({ text: error instanceof Error ? error.message : 'Could not open editor', tone: 'error' });
    }
  }
  openEditorRef.current = (element) => {
    void openElementInEditor(element);
  };

  async function openChipInEditor(chip: ContextChip): Promise<void> {
    if (!chip.file) {
      pushToast({ text: 'No source location for that element', tone: 'error' });
      return;
    }
    try {
      await workspace.request({
        type: 'editor.open',
        file: chip.file,
        ...(chip.line !== undefined ? { line: chip.line } : {}),
        ...(chip.column !== undefined ? { column: chip.column } : {}),
      });
    } catch (error) {
      pushToast({ text: error instanceof Error ? error.message : 'Could not open editor', tone: 'error' });
    }
  }

  function retargetChip(chip: ContextChip, index: number): void {
    const match = /^selection:(\d+)$/.exec(chip.id);
    const slot = match ? Number(match[1]) : 0;
    const current = elementRefs.current[slot];
    if (!current) return;
    const ancestors = breadcrumbAncestors(current);
    const target = ancestors[index] ?? current;
    elementRefs.current = elementRefs.current.map((node, i) => (i === slot ? target : node));
    elementRef.current = elementRefs.current[0] ?? target;
    selectedLocRef.current = elementRef.current.getAttribute('data-loc');
    const located = locateElement(target);
    setSelections((currentSelections) =>
      currentSelections.map((item, i) => (i === slot ? located : item)),
    );
    setSelected(elementRefs.current[0] ? locateElement(elementRefs.current[0]) : located);
  }

  async function beginScreenshot(mode: ScreenshotMode): Promise<void> {
    try {
      if (mode === 'region') {
        setInspecting(false);
        regionRef.current?.stop();
        const picker = new RegionPicker({
          onSelect(rect) {
            void captureRegion(rect)
              .then((url) => openAnnotate(url))
              .catch((error) => failScreenshot(error));
          },
          onCancel() {
            regionRef.current = null;
          },
        });
        regionRef.current = picker;
        picker.start();
        return;
      }
      const url =
        mode === 'viewport'
          ? await captureViewport()
          : await captureElementOrThrow(
              elementRefs.current[elementRefs.current.length - 1] ?? elementRef.current ?? document.body,
            );
      await openAnnotate(url);
    } catch (error) {
      failScreenshot(error);
    }
  }

  async function openAnnotate(dataUrl: string): Promise<void> {
    setAnnotating(dataUrl);
  }

  function failScreenshot(error: unknown): void {
    const message =
      error instanceof CaptureError ? error.message : 'Screenshot capture failed';
    setScreenshotUrl(null);
    setScreenshotError(message);
    setExcludedKinds((current) => current.filter((kind) => kind !== 'screenshot'));
    pushToast({ text: message, tone: 'error' });
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
    dispatchChat({ type: 'reset' });
    setPrompt('');
    setThreadId(null);
    setRunId(null);
    setReviewRunId(null);
    setLiveRunFiles([]);
    setReviewScope('all');
    hydratedThreadId.current = null;
    attachedRunId.current = null;
    seenEventIds.current.clear();
    rememberSession({ prompt: '', threadId: null, runId: null });
    setHistoryOpen(false);
    setExcludedKinds([]);
    setPinnedChips([]);
    setPinnedErrors([]);
    setPinnedRequests([]);
    setChatUnread(false);
    setSideTab('chat');
    setSideOpen(true);
  }

  function fixWithAi(entry: ConsoleEntry): void {
    const chip = chipFromConsoleEntry(entry);
    setPinnedChips([chip]);
    setPinnedErrors(entry.error ? [entry.error] : []);
    setPinnedRequests(entry.request ? [entry.request] : []);
    setExcludedKinds((current) => current.filter((kind) => kind !== chip.kind));
    setPrompt('Fix this error');
    setChatUnread(false);
    openSide('chat', true);
  }

  function insertSuggestion(text: string): void {
    setPrompt((current) => {
      const trimmed = current.trimEnd();
      return trimmed.length === 0 ? text : `${trimmed}\n${text}`;
    });
  }

  const searchFiles = useCallback(
    async (query: string): Promise<string[]> => {
      try {
        const result = await workspace.request({ type: 'files.search', query, limit: 8 });
        return result.files;
      } catch {
        return [];
      }
    },
    [workspace],
  );

  async function resumeThread(id: string): Promise<void> {
    try {
      const result = await workspace.request({ type: 'thread.get', threadId: id });
      hydratedThreadId.current = result.thread.id;
      dispatchChat({ type: 'hydrate', state: hydrateFromThread(result.runs, result.events) });
      seenEventIds.current.clear();
      for (const entry of result.events) seenEventIds.current.add(entry.event.id);
      setThreadId(result.thread.id);
      setProvider(result.thread.provider);
      setModel(result.thread.model);
      setMode(result.thread.mode === 'ask' ? 'ask' : 'agent');
      providerTouched.current = true;
      setHistoryOpen(false);
      setPrompt('');
      setChatUnread(false);
      const live = result.runs.filter((item) => item.status === 'running' || item.status === 'queued');
      const active = live.at(-1);
      if (active) {
        setRunId(active.id);
        rememberSession({ prompt: '', threadId: result.thread.id, runId: active.id });
        attachActiveRun(active.id);
      } else {
        setRunId(null);
        rememberSession({ prompt: '', threadId: result.thread.id, runId: null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open that chat';
      setHistoryError(message);
    }
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
      openReview();
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
    if (id === 'console') {
      openBottom('console', true);
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

  function applyRunEvent(localRunId: string, gatewayRunId: string | undefined, event: UnifiedStreamEvent): void {
    const paths = eventFilePaths(event);
    if (paths.length > 0) rememberRunFiles(gatewayRunId ?? localRunId, paths, event.type === 'files_changed');
    dispatchChat({ type: 'stream', localRunId, gatewayRunId, event });
  }

  function rememberRunFiles(id: string, paths: string[], replace: boolean): void {
    if (paths.length === 0) return;
    setReviewRunId(id);
    setReviewScope('run');
    setLiveRunFiles((current) => (replace ? paths : mergePaths(current, paths)));
  }

  function openReview(runId?: string): void {
    if (runId) {
      setReviewRunId(runId);
      setReviewScope('run');
    } else if (reviewFiles.length > 0 || liveRunFiles.length > 0) {
      setReviewScope('run');
    }
    dismissToastsMatching('Edited');
    openSide('diffs', true);
  }

  async function undoRun(runId: string, force = false): Promise<void> {
    try {
      await workspace.request({
        type: 'git.checkpoint.restore',
        runId,
        ...(force ? { force: true } : {}),
      });
      undoConflictRunId.current = null;
      void refreshDiffs();
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'conflict_newer_run' && !force) {
        undoConflictRunId.current = runId;
        dispatchChat({
          type: 'notice',
          notice: {
            kind: 'notice',
            id: createId(),
            tone: 'warning',
            text: error.message || 'A later run changed these files.',
            actions: [{ label: 'Force undo', action: 'force-undo' }],
          },
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Undo failed';
      pushToast({ text: message, tone: 'error' });
    }
  }

  function handleNoticeAction(item: NoticeItem, action: string): void {
    if (action === 'retry') {
      const text = lastUserText(chatRef.current);
      if (text) void submit(text);
      return;
    }
    if (action === 'copy-command') {
      const command = item.setup?.[0] ?? item.text;
      void navigator.clipboard?.writeText(command).catch(() => undefined);
      return;
    }
    if (action === 'force-undo') {
      const runId = undoConflictRunId.current;
      if (runId) void undoRun(runId, true);
    }
  }

  async function submit(override?: string): Promise<void> {
    const text = (override ?? prompt).trim();
    if (!text || sending) return;
    const requestId = createId();
    const localRunId = createId();
    let sawEdit = false;
    let editedCount = 0;
    let sawError = false;
    let sawDone = false;
    let stopped = false;
    let settled = false;
    let runId: string | undefined;
    const offs: Array<() => void> = [];

    const cleanup = (): void => {
      for (const off of offs.splice(0)) off();
      if (runCleanup.current === cleanup) runCleanup.current = null;
    };

    const finish = (failure?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stopRun.current = null;
      if (!sawDone) {
        if (stopped) {
          applyRunEvent(localRunId, runId, localEvent('done', { status: 'cancelled' }));
        } else if (failure) {
          if (!sawError) applyRunEvent(localRunId, runId, localEvent('error', { error: failure }));
          applyRunEvent(localRunId, runId, localEvent('done', { status: 'failed' }));
        } else {
          applyRunEvent(localRunId, runId, localEvent('done', {}));
        }
      }
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
                  onClick: () => openReview(),
              },
            ],
          });
        });
      } else if (!stopped && sawEdit) {
        void refreshDiffs();
      }
      if (sawEdit) setReviewScope('run');
      setSending(false);
      setRunId(null);
      rememberSession({ runId: null });
    };

    const onStream = (event: UnifiedStreamEvent): void => {
      if (settled) return;
      if (event.type === 'file_edit') {
        sawEdit = true;
        editedCount += 1;
      }
      if (event.type === 'files_changed') {
        sawEdit = true;
        const files = eventFilePaths(event);
        if (files.length > 0) editedCount = Math.max(editedCount, files.length);
      }
      if (event.type === 'error') sawError = true;
      if (event.type === 'done') sawDone = true;
      seenEventIds.current.add(event.id);
      applyRunEvent(localRunId, runId, event);
      if (event.type === 'done') finish();
    };

    setLiveRunFiles([]);
    markRunStart();
    const attachedChips = chips;
    const excluded = new Set(excludedKinds);
    const includeSelection = Boolean(selected) && !excluded.has('selection');
    const includeScreenshot = autoAttach.screenshot && !excluded.has('screenshot');
    const screenshotChip = attachedChips.find((chip) => chip.kind === 'screenshot');
    setSending(true);
    dispatchChat({ type: 'start', input: { userText: text, chips: attachedChips, runId: localRunId } });

    offs.push(
      workspace.on('run.event', (message) => {
        if (message.requestId !== requestId && message.runId !== runId && message.runId !== localRunId) return;
        onStream(message.event);
      }),
    );
    offs.push(
      workspace.on('run.finished', (message) => {
        if (message.requestId !== requestId && message.run.id !== runId && message.run.id !== localRunId) return;
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
      const live = includeSelection ? elementRef.current : null;
      const selectedElement = includeSelection
        ? live?.isConnected
          ? locateElement(live)
          : selected ?? undefined
        : undefined;
      const context = await gatherContext(selectedElement, live, {
        screenshot: false,
        consoleErrors: autoAttach.consoleErrors && !excluded.has('console'),
        failedRequests: autoAttach.failedRequests && !excluded.has('network'),
        pinnedErrors,
        pinnedRequests,
      });
      if (settled) return;
      const attachments =
        includeScreenshot && screenshotChip?.thumbnail && !screenshotChip.warning
          ? [{ kind: 'image' as const, mime: 'image/png', dataUrl: screenshotChip.thumbnail }]
          : [];
      const accepted = await workspace.request({
        type: 'run.start',
        requestId,
        ...(threadIdRef.current ? { threadId: threadIdRef.current } : {}),
        provider,
        ...(model ? { model } : {}),
        mode: mode === 'ask' ? 'ask' : 'agent',
        prompt: text,
        context,
        attachments,
      });
      runId = accepted.runId;
      dispatchChat({ type: 'retarget', from: localRunId, to: accepted.runId });
      if (accepted.threadId) setThreadId(accepted.threadId);
      setRunId(accepted.runId);
      setPrompt('');
      rememberSession({
        prompt: '',
        threadId: accepted.threadId || threadIdRef.current,
        runId: accepted.runId,
      });
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
          Click to attach · Shift+click adds · ↑/↓ walks · ⌥click opens editor · Esc cancels
        </div>
      ) : null}
      {annotating ? (
        <AnnotateLayer
          dataUrl={annotating}
          onCancel={() => setAnnotating(null)}
          onAttach={(dataUrl) => {
            void downscaleDataUrl(dataUrl)
              .then((url) => {
                setScreenshotError(null);
                setScreenshotUrl(url);
                setExcludedKinds((current) => current.filter((kind) => kind !== 'screenshot'));
                setAnnotating(null);
              })
              .catch((error) => {
                setAnnotating(null);
                failScreenshot(error);
              });
          }}
        />
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
        errorCount={errorCount}
        chatUnread={chatUnread}
        status={pillStatus}
        compact={compact}
        corner={pillCorner}
        insetInline={offset.inline}
        insetBlock={offset.block}
        onMove={setPillCorner}
        onToggleInspect={() => setInspecting((value) => !value)}
        onSelectChat={() => openSide('chat')}
        onSelectReview={() => openReview()}
        onSelectTerminal={() => openBottom('terminal')}
        onSelectTests={() => openBottom('tests')}
        onSelectConsole={() => openBottom('console')}
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
          onNewChat={newChat}
          historyOpen={historyOpen}
          onToggleHistory={() => {
            setHistoryOpen((value) => !value);
            openSide('chat', true);
          }}
        >
          {sideTab === 'chat' ? (
            <ChatDrawer
              provider={provider}
              model={model}
              mode={mode}
              providers={providerOptions}
              gatewayStatus={status}
              prompt={prompt}
              chat={chat}
              chips={chips}
              suggestions={suggestions}
              sending={sending}
              historyOpen={historyOpen}
              historyRows={historyRows}
              historyLoading={historyLoading}
              historyError={historyError}
              threadId={threadId}
              onPromptChange={setPrompt}
              onProviderChange={(next) => {
                providerTouched.current = true;
                setProvider(next);
                const cap = capabilities.find((item) => item.provider === next);
                if (model && cap && !cap.models.some((item) => item.id === model)) setModel(null);
              }}
              onModelChange={setModel}
              onModeChange={(next) => setMode(next === 'ask' ? 'ask' : 'agent')}
              onRemoveChip={(chip: ContextChip) => {
                setPinnedChips((current) => current.filter((item) => item.id !== chip.id));
                if (chip.id.startsWith('fix:')) {
                  setPinnedErrors([]);
                  setPinnedRequests([]);
                } else if (chip.kind !== 'selection') {
                  setExcludedKinds((current) => (current.includes(chip.kind) ? current : [...current, chip.kind]));
                }
                if (chip.kind === 'selection') {
                  const match = /^selection:(\d+)$/.exec(chip.id);
                  const slot = match ? Number(match[1]) : 0;
                  const nextEls = elementRefs.current.filter((_, index) => index !== slot);
                  const next = selections.filter((_, index) => index !== slot);
                  elementRefs.current = nextEls;
                  elementRef.current = nextEls[0] ?? null;
                  selectedLocRef.current = nextEls[0]?.getAttribute('data-loc') ?? null;
                  setSelections(next);
                  setSelected(next[0] ?? null);
                }
                if (chip.kind === 'screenshot') {
                  setScreenshotUrl(null);
                  setScreenshotError(null);
                }
              }}
              onOpenEditor={(chip) => {
                void openChipInEditor(chip);
              }}
              onBreadcrumb={retargetChip}
              onScreenshot={(mode) => {
                void beginScreenshot(mode);
              }}
              onAnnotateScreenshot={(chip) => {
                if (chip.thumbnail) void openAnnotate(chip.thumbnail);
              }}
              onSuggest={insertSuggestion}
              onSearchFiles={searchFiles}
              onSubmit={() => {
                void submit();
              }}
              onStop={() => stopRun.current?.()}
              onReview={(id) => openReview(id)}
              onUndo={(runId) => {
                void undoRun(runId);
              }}
              onKeepGoing={() => setPrompt('Keep going')}
              onNoticeAction={handleNoticeAction}
              onResumeThread={(id) => {
                void resumeThread(id);
              }}
              onEscapeOverlay={(handler) => {
                composerEscape.current = handler;
              }}
            />
          ) : (
            <DiffViewer
              workspace={workspace}
              summary={summary}
              loading={diffLoading}
              error={diffError}
              scope={reviewScope}
              runFiles={reviewFiles}
              onScopeChange={setReviewScope}
              viewMode={diffView}
              onViewModeChange={setDiffView}
              onToast={pushToast}
              suggestedBranch={suggestedBranch}
            />
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
          {bottomOpen && bottomTab === 'console' ? (
            <ConsolePanel workspace={workspace} onFix={fixWithAi} />
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
): Promise<{ providers: ProviderStatus[]; capabilities: ProviderCapabilities[]; version: string | null }> {
  const response = await fetch(new URL('/api/v1/status', gatewayUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { providers: [], capabilities: [], version: null };
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') return { providers: [], capabilities: [], version: null };
  const record = body as { providers?: unknown; version?: unknown };
  const version = typeof record.version === 'string' ? record.version : null;
  if (!Array.isArray(record.providers)) return { providers: [], capabilities: [], version };
  const statuses: ProviderStatus[] = [];
  const capabilities: ProviderCapabilities[] = [];
  for (const item of record.providers) {
    const parsed = ProviderCapabilitiesSchema.safeParse(item);
    if (parsed.success) {
      capabilities.push(parsed.data);
      statuses.push({ provider: parsed.data.provider, available: parsed.data.available });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const entry = item as { provider?: unknown; available?: unknown };
    if (!isProvider(entry.provider)) continue;
    statuses.push({ provider: entry.provider, available: entry.available === true });
  }
  return { providers: statuses, capabilities, version };
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

function buildProviderOptions(
  capabilities: readonly ProviderCapabilities[],
  availability: Partial<Record<ProviderType, boolean>>,
): ProviderOption[] {
  const known = capabilities.length > 0 || Object.keys(availability).length > 0;
  return PROVIDER_LABELS.map((item) => {
    const cap = capabilities.find((entry) => entry.provider === item.id);
    const available = cap?.available ?? availability[item.id];
    return {
      id: item.id,
      label: item.label,
      available: known ? available === true : true,
      experimental: cap ? cap.verified === false : false,
      ...(cap?.setup && cap.setup.length > 0 ? { setup: cap.setup.join('\n') } : {}),
      models: cap?.models ?? [],
      modes: cap?.modes ?? ['agent', 'ask', 'plan'],
    };
  });
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

type ChatAction =
  | { type: 'reset' }
  | { type: 'hydrate'; state: ChatState }
  | { type: 'start'; input: Parameters<typeof startTurn>[1] }
  | { type: 'stream'; localRunId: string; gatewayRunId?: string; event: UnifiedStreamEvent }
  | { type: 'retarget'; from: string; to: string }
  | { type: 'notice'; notice: NoticeItem };

function reduceChat(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset':
      return emptyChatState();
    case 'hydrate':
      return action.state;
    case 'start':
      return startTurn(state, action.input);
    case 'retarget':
      return retargetRun(state, action.from, action.to);
    case 'notice':
      return { items: [...state.items, action.notice] };
    case 'stream': {
      const aligned =
        action.gatewayRunId && action.gatewayRunId !== action.localRunId
          ? retargetRun(state, action.localRunId, action.gatewayRunId)
          : state;
      return applyEvent(aligned, action.gatewayRunId ?? action.localRunId, action.event);
    }
    default:
      return state;
  }
}

function retargetRun(state: ChatState, from: string, to: string): ChatState {
  if (from === to) return state;
  let changed = false;
  const items = state.items.map((item) => {
    if (item.kind !== 'assistant' || item.runId !== from) return item;
    changed = true;
    return { ...item, runId: to };
  });
  return changed ? { items } : state;
}

function eventFilePaths(event: UnifiedStreamEvent): string[] {
  if (event.type === 'file_edit' && event.payload.filePath) return [event.payload.filePath];
  if (event.type !== 'files_changed' || !event.payload.files) return [];
  return event.payload.files.filter((file) => file.length > 0);
}

function mergePaths(current: readonly string[], extra: readonly string[]): string[] {
  const next = [...current];
  for (const path of extra) {
    if (!next.includes(path)) next.push(path);
  }
  return next;
}

function slugBranch(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'change';
}

function lastUserText(state: ChatState): string | undefined {
  for (let index = state.items.length - 1; index >= 0; index -= 1) {
    const item = state.items[index];
    if (item?.kind === 'user') return item.text;
  }
  return undefined;
}

function localEvent(
  type: UnifiedStreamEvent['type'],
  payload: StreamEventPayload & { status?: string },
): UnifiedStreamEvent {
  return {
    id: createId(),
    sessionId: 'local',
    type,
    timestamp: Date.now(),
    payload: payload as StreamEventPayload,
  };
}
