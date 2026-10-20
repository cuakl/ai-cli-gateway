export { BaseAdapter } from './adapters/base.js';
export {
  AntigravityAdapter,
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  DEFAULT_CLAUDE_TOOLS,
  cleanupCursorEphemeral,
  createAdapter,
  getAvailableAdapters,
} from './adapters/index.js';
export type { AdapterAvailability, CreateAdapterOptions } from './adapters/index.js';
export { ProcessManager } from './session/manager.js';
export {
  DEFAULT_SIGKILL_GRACE_MS,
  ManagedProcess,
  ProcessTimeoutError,
} from './session/process.js';
export type { ManagedProcessOptions } from './session/process.js';
export { LineBuffer } from './session/stream.js';
export type { CLIAdapter, ExecuteResult } from './types/adapter.js';
export {
  BinaryNotFoundError,
  BinaryResolver,
  CliAuthError,
  defaultProviderCandidates,
  describeAuthFailure,
  isExecutable,
  providerSetup,
  whichCommand,
} from './utils/binary.js';
export type { BinaryResolverOptions, ProviderCandidates, ResolveTarget } from './utils/binary.js';
export { PathEscapeError, confineToRoot, confineWorkspace, isInsideRoot } from './utils/paths.js';
export { logger } from './utils/logger.js';
export type { LogLevel } from './utils/logger.js';

export {
  DEFAULT_PROCESS_TIMEOUT_MS,
  FrontendContextPayloadSchema,
  GitCommitRequestSchema,
  GitDiffSummarySchema,
  PromptOptionsSchema,
  PromptRequestSchema,
  ProviderTypeSchema,
  UnifiedStreamEventSchema,
  createStreamEvent,
} from '@gateway/shared-types';
export type {
  FrontendContextPayload,
  GitCommitRequest,
  GitDiffSummary,
  PromptOptions,
  PromptRequest,
  ProviderType,
  StreamEventType,
  UnifiedStreamEvent,
} from '@gateway/shared-types';
