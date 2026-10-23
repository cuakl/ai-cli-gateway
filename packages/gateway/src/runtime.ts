import {
  BinaryResolver,
  ProcessManager,
  createAdapter,
  getAvailableAdapters,
  type AdapterAvailability,
  type CLIAdapter,
} from '@aidev/adapters';
import type { ProviderType } from '@aidev/protocol';

/**
 * The server asks the runtime for a provider adapter and for the detected CLIs.
 * One ProcessManager is shared so `adapter.kill(sessionId)` reaches the child
 * that `execute` spawned, including across later HTTP requests.
 */
export interface GatewayRuntime {
  getAdapter(provider: ProviderType): CLIAdapter;
  listProviders(): Promise<AdapterAvailability[]>;
}

export function createDefaultRuntime(): GatewayRuntime {
  const binaries = new BinaryResolver();
  const processes = new ProcessManager();
  const adapters = new Map<ProviderType, CLIAdapter>();

  return {
    getAdapter(provider) {
      const existing = adapters.get(provider);
      if (existing) return existing;
      const adapter = createAdapter(provider, { binaries, processes });
      adapters.set(provider, adapter);
      return adapter;
    },
    listProviders() {
      return getAvailableAdapters({ binaries });
    },
  };
}
