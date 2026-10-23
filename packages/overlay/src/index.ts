import { defineAiDevtools } from './core/overlay.js';

export { AiDevtoolsElement, defineAiDevtools, initDevtools } from './core/overlay.js';
export { gatherContext, installContextCollectors, uninstallContextCollectors } from './context/index.js';
export { captureElement } from './context/screenshot.js';
export { getReactSource } from './inspector/fiber.js';
export {
  locateElement,
  parseDataLoc,
  readDataLoc,
  resolveSourceLocation,
  selectionChipLabel,
} from './inspector/locator.js';
export { ElementPicker, HIGHLIGHT_ID, describeElement, highlightFrame } from './inspector/picker.js';
export { DEFAULT_GATEWAY_URL, OVERLAY_TAG } from './types.js';
export {
  CLI_NAME,
  ELEMENT_TAG,
  EVENT_PREFIX,
  GLOBAL_CONFIG_KEY,
  HOME_DIRNAME,
  PRODUCT_NAME,
  SCOPE,
} from './brand.js';
export type { DevtoolsConfig, DevtoolsPanel, DockMode, OverlayTheme, ProviderStatus } from './types.js';
export {
  WorkspaceClient,
  WorkspaceError,
  workspaceSocketUrl,
} from './ui/workspace-client.js';
export type {
  WorkspaceConnection,
  WorkspaceConnectionState,
  WorkspaceSocket,
  WorkspaceSocketConstructor,
} from './ui/workspace-client.js';

defineAiDevtools();
