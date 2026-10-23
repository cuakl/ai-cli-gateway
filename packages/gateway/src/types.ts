import type { AidevConfig } from '@aidev/protocol';
import type { AuthService } from './auth/principal.js';
import type { ProjectRegistry } from './projects/registry.js';
import type { GatewayRuntime } from './runtime.js';
import type { SessionRegistry } from './sessions/registry.js';
import type { ActiveRuns } from './threads/active.js';
import type { RunScheduler } from './threads/scheduler.js';
import type { ThreadStore } from './threads/store.js';
import type { WorkspaceHub } from './ws/hub.js';

export interface ServerDeps {
  registry: SessionRegistry;
  runtime: GatewayRuntime;
  home: string;
  projects: ProjectRegistry;
  auth: AuthService;
  threads: ThreadStore;
  runs: ActiveRuns;
  scheduler: RunScheduler;
  hub: WorkspaceHub;
  config: AidevConfig;
  /** Bind address used for the loopback PTY check. Defaults to 127.0.0.1. */
  bindHost: string;
  /** When set, this directory was auto-registered at startup (`GATEWAY_ROOT` or a test root). */
  root?: string;
}
