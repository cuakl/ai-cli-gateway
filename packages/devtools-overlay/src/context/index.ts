import {
  FrontendContextPayloadSchema,
  type FrontendContextPayload,
  type SelectedElement,
} from '@gateway/shared-types';
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

export async function gatherContext(
  selectedElement?: SelectedElement,
  element?: Element | null,
): Promise<FrontendContextPayload> {
  const screenshot = element ? await captureElement(element) : undefined;
  return FrontendContextPayloadSchema.parse({
    ...(selectedElement ? { selectedElement } : {}),
    ...(screenshot ? { screenshotBase64: screenshot } : {}),
    recentErrors: getErrors(),
    recentConsoleLogs: getConsoleLogs(),
    failedNetworkRequests: getFailedNetworkRequests(),
  });
}
