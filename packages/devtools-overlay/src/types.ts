import type { FrontendContextPayload, ProviderType } from '@gateway/shared-types';

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

export const OVERLAY_TAG = 'ai-devtools';

export type GatewayTransportMode = 'auto' | 'websocket' | 'sse';

export interface StreamPromptInput {
  provider: ProviderType;
  prompt: string;
  cwd?: string;
  context?: FrontendContextPayload;
  onChunk?: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** Small surface the chat drawer needs. Tests substitute a fake. */
export interface GatewayBridge {
  checkHealth(): Promise<boolean>;
  streamPrompt(input: StreamPromptInput): Promise<void>;
  cancel(): void;
}

export interface DevtoolsConfig {
  gatewayUrl?: string;
  cwd?: string;
  transport?: GatewayTransportMode;
  client?: GatewayBridge;
}
