import type { ProviderType, RunMode } from '@aidev/protocol';
import {
  BOTTOM_DEFAULT,
  SIDE_CHAT_DEFAULT,
  clampBottomHeight,
  clampSideWidth,
  parseDockMode,
  type BottomTab,
  type DockMode,
  type PillCorner,
  type SideTab,
} from './layout/geometry.js';
import { parseTheme, type OverlayTheme } from './theme/tokens.js';

export const PREFS_KEY = 'aidev:prefs';

export interface AutoAttachPrefs {
  consoleErrors: boolean;
  failedRequests: boolean;
  screenshot: boolean;
}

export interface OverlayPrefs {
  theme: OverlayTheme;
  dockMode: DockMode;
  provider: ProviderType;
  model: string | null;
  mode: RunMode;
  autoAttach: AutoAttachPrefs;
  pillCorner: PillCorner;
  sideWidth: number;
  bottomHeight: number;
}

export interface OverlaySession {
  sideOpen: boolean;
  sideTab: SideTab;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  prompt: string;
  threadId: string | null;
  selectedLoc: string | null;
}

export const DEFAULT_AUTO_ATTACH: AutoAttachPrefs = {
  consoleErrors: true,
  failedRequests: true,
  screenshot: true,
};

export function sessionStorageKey(projectId: string): string {
  return `aidev:session:${projectId || 'default'}`;
}

export function loadPrefs(): Partial<OverlayPrefs> {
  const raw = readJson(storage('local'), PREFS_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const autoAttach = parseAutoAttach(record.autoAttach);
  const prefs: Partial<OverlayPrefs> = {};
  const theme = parseTheme(record.theme);
  if (theme) prefs.theme = theme;
  const dockMode = parseDockMode(record.dockMode);
  if (dockMode) prefs.dockMode = dockMode;
  const provider = parseProvider(record.provider);
  if (provider) prefs.provider = provider;
  if (record.model === null) prefs.model = null;
  else if (typeof record.model === 'string' && record.model.length > 0) prefs.model = record.model;
  const mode = parseMode(record.mode);
  if (mode) prefs.mode = mode;
  if (autoAttach) prefs.autoAttach = autoAttach;
  const corner = parseCorner(record.pillCorner);
  if (corner) prefs.pillCorner = corner;
  if (typeof record.sideWidth === 'number' && Number.isFinite(record.sideWidth)) {
    prefs.sideWidth = clampSideWidth(record.sideWidth);
  }
  if (typeof record.bottomHeight === 'number' && Number.isFinite(record.bottomHeight)) {
    prefs.bottomHeight = clampBottomHeight(record.bottomHeight, 10_000);
  }
  return prefs;
}

export function savePrefs(prefs: OverlayPrefs): void {
  writeJson(storage('local'), PREFS_KEY, prefs);
}

export function loadSession(projectId: string): Partial<OverlaySession> {
  const raw = readJson(storage('session'), sessionStorageKey(projectId));
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const session: Partial<OverlaySession> = {};
  if (typeof record.sideOpen === 'boolean') session.sideOpen = record.sideOpen;
  if (record.sideTab === 'chat' || record.sideTab === 'diffs') session.sideTab = record.sideTab;
  if (typeof record.bottomOpen === 'boolean') session.bottomOpen = record.bottomOpen;
  if (record.bottomTab === 'terminal' || record.bottomTab === 'tests') session.bottomTab = record.bottomTab;
  if (typeof record.prompt === 'string') session.prompt = record.prompt;
  if (typeof record.threadId === 'string' || record.threadId === null) session.threadId = record.threadId;
  if (typeof record.selectedLoc === 'string' || record.selectedLoc === null) session.selectedLoc = record.selectedLoc;
  return session;
}

export function saveSession(projectId: string, session: OverlaySession): void {
  writeJson(storage('session'), sessionStorageKey(projectId), session);
}

export function defaultPrefs(): OverlayPrefs {
  return {
    theme: 'dark',
    dockMode: 'push',
    provider: 'cursor',
    model: null,
    mode: 'agent',
    autoAttach: { ...DEFAULT_AUTO_ATTACH },
    pillCorner: 'bottom-right',
    sideWidth: SIDE_CHAT_DEFAULT,
    bottomHeight: BOTTOM_DEFAULT,
  };
}

export function locSelector(loc: string): string {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(loc) : loc.replace(/"/g, '\\"');
  return `[data-loc="${escaped}"]`;
}

function parseAutoAttach(value: unknown): AutoAttachPrefs | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    consoleErrors: record.consoleErrors !== false,
    failedRequests: record.failedRequests !== false,
    screenshot: record.screenshot !== false,
  };
}

function parseProvider(value: unknown): ProviderType | undefined {
  if (value === 'cursor' || value === 'claude' || value === 'codex' || value === 'antigravity') return value;
  return undefined;
}

function parseMode(value: unknown): RunMode | undefined {
  if (value === 'agent' || value === 'ask' || value === 'plan') return value;
  return undefined;
}

function parseCorner(value: unknown): PillCorner | undefined {
  if (value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'bottom-right') return value;
  return undefined;
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson(store: Storage | null, key: string): unknown {
  if (!store) return undefined;
  try {
    const raw = store.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode.
  }
}
