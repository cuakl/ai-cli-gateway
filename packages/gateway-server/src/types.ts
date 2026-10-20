import type { GatewayRuntime } from './runtime.js';
import type { SessionRegistry } from './sessions/registry.js';

export interface ServerDeps {
  registry: SessionRegistry;
  runtime: GatewayRuntime;
}
