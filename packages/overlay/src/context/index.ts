import {
  FrontendContextPayloadSchema,
  type FrontendContextPayload,
  type SelectedElement,
} from '@aidev/protocol';
import { getConsoleLogs, installConsoleCapture, setConsoleErrorHook, uninstallConsoleCapture } from './console.js';
import { getErrors, installErrorCapture, recordError, uninstallErrorCapture } from './errors.js';
import { getFailedNetworkRequests, installNetworkCapture, uninstallNetworkCapture } from './network.js';
import { captureElement } from './screenshot.js';

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
  consoleErrors?: boolean;
  failedRequests?: boolean;
}

export async function gatherContext(
  selectedElement?: SelectedElement,
  element?: Element | null,
  options: GatherContextOptions = {},
): Promise<FrontendContextPayload> {
  const attachScreenshot = options.screenshot !== false;
  const attachConsole = options.consoleErrors !== false;
  const attachNetwork = options.failedRequests !== false;
  const screenshot = attachScreenshot && element ? await captureElement(element) : undefined;
  return FrontendContextPayloadSchema.parse({
    ...(selectedElement ? { selectedElement } : {}),
    ...(screenshot ? { screenshotBase64: screenshot } : {}),
    recentErrors: attachConsole ? getErrors() : [],
    recentConsoleLogs: attachConsole ? getConsoleLogs() : [],
    failedNetworkRequests: attachNetwork ? getFailedNetworkRequests() : [],
  });
}
