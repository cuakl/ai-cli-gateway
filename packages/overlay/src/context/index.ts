import {
  FrontendContextPayloadSchema,
  type FrontendContextPayload,
  type FrontendError,
  type SelectedElement,
} from '@aidev/protocol';
import { subscribeContext } from './bus.js';
import { getConsoleLogs, installConsoleCapture, setConsoleErrorHook, uninstallConsoleCapture } from './console.js';
import { getErrors, installErrorCapture, recordError, uninstallErrorCapture } from './errors.js';
import {
  getFailedNetworkRequests,
  getRecentFailedNetworkRequests,
  installNetworkCapture,
  uninstallNetworkCapture,
} from './network.js';
import { captureElement } from './screenshot.js';

export { subscribeContext } from './bus.js';

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
}

export function uninstallContextCollectors(): void {
  uninstallConsoleCapture();
  uninstallErrorCapture();
  uninstallNetworkCapture();
}

export interface GatherContextOptions {
  screenshot?: boolean;
  /** Already-captured PNG data URL; skips a second `toPng` when set. */
  screenshotDataUrl?: string;
  consoleErrors?: boolean;
  failedRequests?: boolean;
  /** Defaults to {@link CONTEXT_MAX_AGE_MS}. Pass `Infinity` to skip the age filter. */
  maxAgeMs?: number;
  now?: number;
}

export function getRecentErrors(maxAgeMs = CONTEXT_MAX_AGE_MS, now = Date.now()): FrontendError[] {
  return getErrors().filter((entry) => now - entry.timestamp <= maxAgeMs);
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
  return FrontendContextPayloadSchema.parse({
    ...(selectedElement ? { selectedElement } : {}),
    ...(screenshot ? { screenshotBase64: screenshot } : {}),
    recentErrors: attachConsole ? getRecentErrors(maxAgeMs, now) : [],
    recentConsoleLogs: attachConsole
      ? getConsoleLogs().filter((entry) => now - entry.timestamp <= maxAgeMs)
      : [],
    failedNetworkRequests: attachNetwork ? getRecentFailedNetworkRequests(maxAgeMs, now) : [],
  });
}
