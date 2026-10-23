import { ProviderTypeSchema, type ProviderType } from '@aidev/protocol';
import type { ProcessManager } from '../session/manager.js';
import type { CLIAdapter } from '../types/adapter.js';
import { BinaryResolver } from '../utils/binary.js';
import { AntigravityAdapter } from './antigravity.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { CursorAdapter } from './cursor.js';

export interface CreateAdapterOptions {
  binaries?: BinaryResolver;
  processes?: ProcessManager;
}

export interface AdapterAvailability {
  provider: ProviderType;
  available: boolean;
  binaryPath: string | null;
}

export function createAdapter(provider: ProviderType, options?: CreateAdapterOptions): CLIAdapter {
  const binaries = options?.binaries;
  const processes = options?.processes;
  switch (provider) {
    case 'cursor':
      return new CursorAdapter(binaries, processes);
    case 'antigravity':
      return new AntigravityAdapter(binaries, processes);
    case 'claude':
      return new ClaudeAdapter(binaries, processes);
    case 'codex':
      return new CodexAdapter(binaries, processes);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}

export async function getAvailableAdapters(options?: {
  binaries?: BinaryResolver;
}): Promise<AdapterAvailability[]> {
  const binaries = options?.binaries ?? new BinaryResolver();
  const detected = await binaries.detectAll();
  return ProviderTypeSchema.options.map((provider) => ({
    provider,
    available: detected[provider] !== null,
    binaryPath: detected[provider],
  }));
}

export { AntigravityAdapter } from './antigravity.js';
export { ClaudeAdapter, DEFAULT_CLAUDE_TOOLS } from './claude.js';
export { CodexAdapter } from './codex.js';
export { CursorAdapter } from './cursor.js';
