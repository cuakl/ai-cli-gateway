import type {
  FrontendContextPayload,
  GitCommitRequest,
  GitDiffSummary,
  ProviderType,
} from '@aidev/protocol';
import { ELEMENT_TAG } from './brand.js';

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

export const OVERLAY_TAG = ELEMENT_TAG;

export type GatewayTransportMode = 'auto' | 'websocket' | 'sse';

export interface StreamPromptInput {
  provider: ProviderType;
  prompt: string;
  cwd?: string;
  context?: FrontendContextPayload;
  onChunk?: (text: string) => void;
  onTool?: (toolName: string, filePath?: string) => void;
  onFileEdit?: (filePath: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface ProviderStatus {
  provider: ProviderType;
  available: boolean;
}

/** Git, PTY, and test calls the overlay makes over the Vite HMR socket. */
export interface DevtoolsBridge {
  gitDiff(): Promise<GitDiffSummary>;
  gitCommit(request: GitCommitRequest): Promise<{ commitHash: string; branch: string }>;
  gitRevert(files?: string[]): Promise<void>;
  runTests(onLine: (line: string) => void): Promise<{ exitCode: number; command: string; cancelled?: boolean }>;
  stopTests(): void;
  spawnPty(cols: number, rows: number): Promise<{ sessionId: string; fallback: boolean }>;
  writePty(sessionId: string, data: string): void;
  resizePty(sessionId: string, cols: number, rows: number): void;
  disposePty(sessionId: string): void;
  onPtyData(listener: (sessionId: string, data: string) => void): () => void;
  onPtyExit(listener: (sessionId: string, code: number) => void): () => void;
}

export type DevtoolsPanel = 'chat' | 'diffs' | 'terminal' | 'tests';

/** Small surface the chat drawer needs. Tests substitute a fake. */
export interface GatewayBridge {
  checkHealth(): Promise<boolean>;
  listProviders?(): Promise<ProviderStatus[]>;
  streamPrompt(input: StreamPromptInput): Promise<void>;
  cancel(): void;
}

export interface DevtoolsConfig {
  gatewayUrl?: string;
  cwd?: string;
  /** package.json name, shown on the Tests panel. */
  projectName?: string;
  /** Browser token injected by the Vite plugin. */
  token?: string;
  transport?: GatewayTransportMode;
  client?: GatewayBridge;
  bridge?: DevtoolsBridge;
}
