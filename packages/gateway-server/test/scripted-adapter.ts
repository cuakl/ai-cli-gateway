import type { AdapterAvailability, CLIAdapter, ExecuteResult } from '@gateway/core';
import type { GatewayRuntime } from '../src/runtime.js';
import type { PromptOptions, ProviderType, UnifiedStreamEvent } from '@gateway/shared-types';

export interface ScriptContext {
  options: PromptOptions;
  onEvent: (event: UnifiedStreamEvent) => void;
  sessionId: string;
  waitUntilKilled: () => Promise<void>;
  wasKilled: () => boolean;
}

/** In-process adapter. `kill` resolves `waitUntilKilled` even if it happens first. */
export class ScriptedAdapter implements CLIAdapter {
  readonly provider: ProviderType;
  readonly kills: string[] = [];
  private readonly waiters = new Map<string, () => void>();

  constructor(
    provider: ProviderType,
    private readonly run: (ctx: ScriptContext) => Promise<ExecuteResult>,
  ) {
    this.provider = provider;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getBinaryPath(): Promise<string> {
    return `/mock/bin/${this.provider}`;
  }

  async execute(
    options: PromptOptions,
    onEvent: (event: UnifiedStreamEvent) => void,
  ): Promise<ExecuteResult> {
    const sessionId = options.sessionId ?? 'missing-session';
    return this.run({
      options,
      onEvent,
      sessionId,
      wasKilled: () => this.kills.includes(sessionId),
      waitUntilKilled: () => {
        if (this.kills.includes(sessionId)) return Promise.resolve();
        return new Promise<void>((resolve) => {
          this.waiters.set(sessionId, resolve);
        });
      },
    });
  }

  async kill(sessionId: string): Promise<boolean> {
    this.kills.push(sessionId);
    const resolve = this.waiters.get(sessionId);
    if (resolve) {
      this.waiters.delete(sessionId);
      resolve();
    }
    return true;
  }
}

const PROVIDERS = ['cursor', 'antigravity', 'claude', 'codex'] as const;

export function runtimeFor(adapters: Partial<Record<ProviderType, CLIAdapter>>): GatewayRuntime {
  return {
    getAdapter(provider) {
      const adapter = adapters[provider];
      if (!adapter) throw new Error(`Provider ${provider} is not available`);
      return adapter;
    },
    async listProviders(): Promise<AdapterAvailability[]> {
      const listed: AdapterAvailability[] = [];
      for (const provider of PROVIDERS) {
        const adapter = adapters[provider];
        if (!adapter) {
          listed.push({ provider, available: false, binaryPath: null });
          continue;
        }
        try {
          listed.push({ provider, available: true, binaryPath: await adapter.getBinaryPath() });
        } catch {
          listed.push({ provider, available: false, binaryPath: null });
        }
      }
      return listed;
    },
  };
}
