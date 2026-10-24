import {
  FrontendContextPayloadSchema,
  type FailedNetworkRequest,
  type FrontendContextPayload,
  type FrontendError,
  type SelectedElement,
} from '@aidev/protocol';
import { getConsoleLogs, installConsoleCapture, setConsoleErrorHook, uninstallConsoleCapture } from './console.js';
import {
  getErrors,
  getRunStartedAt,
  installErrorCapture,
  recordError,
  uninstallErrorCapture,
} from './errors.js';
import {
  getRecentFailedNetworkRequests,
  getStoredFailedNetworkRequests,
  installNetworkCapture,
  uninstallNetworkCapture,
} from './network.js';
import { redactContext } from './redact.js';
import { captureElement } from './screenshot.js';
import { getViteError, installViteCapture, uninstallViteCapture } from './vite.js';

export { subscribeContext } from './bus.js';
export { CONTEXT_JSON_LIMIT, redactContext } from './redact.js';
export { listConsoleEntries, filterConsoleEntries, type ConsoleEntry, type ConsoleFilter } from './entries.js';
export { getViteError, setViteFixHandler } from './vite.js';
export { markRunStart, getErrors } from './errors.js';
export { getStoredFailedNetworkRequests } from './network.js';

/** Errors and failed requests older than this are not auto-attached. */
export const CONTEXT_MAX_AGE_MS = 2 * 60 * 1000;

export interface ContextCollectorOptions {
  gatewayUrl?: string;
}

export function installContextCollectors(options: ContextCollectorOptions = {}): void {
  installConsoleCapture();
  setConsoleErrorHook((entry) => {
    recordError({
      type: 'console_error',
      message: entry.args.join(' '),
      timestamp: entry.timestamp,
    });
  });
  installErrorCapture();
  installNetworkCapture(options.gatewayUrl);
  installViteCapture();
}

export function uninstallContextCollectors(): void {
  uninstallConsoleCapture();
  uninstallErrorCapture();
  uninstallNetworkCapture();
  uninstallViteCapture();
}

export interface GatherContextOptions {
  screenshot?: boolean;
  /** Already-captured PNG data URL; skips a second `toPng` when set. */
  screenshotDataUrl?: string;
  consoleErrors?: boolean;
  failedRequests?: boolean;
  pinnedErrors?: readonly FrontendError[];
  pinnedRequests?: readonly FailedNetworkRequest[];
  /** Extra selected elements (max 5). `selectedElement` stays the first for backward compat. */
  selectedElements?: readonly SelectedElement[];
  /** Defaults to {@link CONTEXT_MAX_AGE_MS}. Pass `Infinity` to skip the age filter. */
  maxAgeMs?: number;
  now?: number;
}

export function getRecentErrors(maxAgeMs = CONTEXT_MAX_AGE_MS, now = Date.now()): FrontendError[] {
  return getErrors().filter((entry) => now - entry.timestamp <= maxAgeMs);
}

export function getErrorCountSinceRun(now = Date.now()): number {
  const since = getRunStartedAt();
  const errors = getErrors().filter((entry) => entry.timestamp >= since).length;
  const network = getStoredFailedNetworkRequests().filter((entry) => entry.timestamp >= since).length;
  return errors + network;
}

export async function gatherContext(
  selectedElement?: SelectedElement,
  element?: Element | null,
  options: GatherContextOptions = {},
): Promise<FrontendContextPayload> {
  const attachScreenshot = options.screenshot !== false;
  const attachConsole = options.consoleErrors !== false;
  const attachNetwork = options.failedRequests !== false;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? CONTEXT_MAX_AGE_MS;
  const screenshot =
    attachScreenshot && options.screenshotDataUrl
      ? options.screenshotDataUrl
      : attachScreenshot && element
        ? await captureElement(element)
        : undefined;
  const recentErrors = attachConsole ? getRecentErrors(maxAgeMs, now) : [];
  for (const pinned of options.pinnedErrors ?? []) {
    if (!recentErrors.some((entry) => sameError(entry, pinned))) recentErrors.push(pinned);
  }
  const vite = getViteError();
  if (vite && attachConsole && !recentErrors.some((entry) => sameError(entry, vite))) {
    recentErrors.push(vite);
  }
  const selectedElements = (options.selectedElements ?? (selectedElement ? [selectedElement] : [])).slice(0, 5);
  const first = selectedElements[0] ?? selectedElement;
  const payload = FrontendContextPayloadSchema.parse({
    ...(first ? { selectedElement: first } : {}),
    ...(selectedElements.length > 0 ? { selectedElements } : {}),
    ...(screenshot ? { screenshotBase64: screenshot } : {}),
    recentErrors,
    recentConsoleLogs: attachConsole
      ? getConsoleLogs().filter((entry) => now - entry.timestamp <= maxAgeMs)
      : [],
    failedNetworkRequests: mergeRequests(
      attachNetwork ? getRecentFailedNetworkRequests(maxAgeMs, now) : [],
      options.pinnedRequests ?? [],
    ),
  });
  return redactContext(payload);
}

function sameError(left: FrontendError, right: FrontendError): boolean {
  return left.type === right.type && left.message === right.message && left.timestamp === right.timestamp;
}

function mergeRequests(
  current: FailedNetworkRequest[],
  pinned: readonly FailedNetworkRequest[],
): FailedNetworkRequest[] {
  const merged = current.slice();
  for (const request of pinned) {
    if (!merged.some((entry) => entry.url === request.url && entry.status === request.status && entry.durationMs === request.durationMs)) {
      merged.push(request);
    }
  }
  return merged;
}
