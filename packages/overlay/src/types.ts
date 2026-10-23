import type { ProviderType } from '@aidev/protocol';
import { ELEMENT_TAG } from './brand.js';
import type { OverlayTheme } from './ui/theme/tokens.js';
import type { WorkspaceConnection } from './ui/workspace-client.js';

export type { OverlayTheme };

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

export const OVERLAY_TAG = ELEMENT_TAG;

export interface ProviderStatus {
  provider: ProviderType;
  available: boolean;
}

export type DevtoolsPanel = 'chat' | 'diffs' | 'terminal' | 'tests';

export interface DevtoolsConfig {
  gatewayUrl?: string;
  /** From `POST /api/v1/projects/register`. */
  projectId?: string;
  /** Browser token for this project. Sent on the workspace socket and `GET /api/v1/status`. */
  browserToken?: string;
  /** package.json name, shown on the Tests panel. */
  projectName?: string;
  /** Color theme. Defaults to `dark`. `system` follows `prefers-color-scheme`. */
  theme?: OverlayTheme;
  /** Test double. When set, the overlay does not open its own socket. */
  workspace?: WorkspaceConnection;
}
