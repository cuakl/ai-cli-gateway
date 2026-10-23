import { chmod, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderType, UnifiedStreamEvent } from '../../src/index.js';
import { BinaryResolver } from '../../src/utils/binary.js';

const FIXTURES = [
  'mock-agy.js',
  'mock-cursor.js',
  'mock-claude.js',
  'mock-codex.js',
  'mock-error.js',
  'mock-hang.js',
] as const;

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function fixture(name: (typeof FIXTURES)[number]): string {
  return join(fixturesDir, name);
}

export async function ensureFixtures(): Promise<void> {
  await Promise.all(FIXTURES.map((name) => chmod(fixture(name), 0o755)));
}

export function resolverFor(provider: ProviderType, binaryPath: string): BinaryResolver {
  return new BinaryResolver({
    which: async () => null,
    isExecutable: async (filePath) => filePath === binaryPath,
    candidates: {
      [provider]: { commands: [`missing-${provider}-binary`], paths: [binaryPath] },
    },
  });
}

export function collectEvents(): {
  events: UnifiedStreamEvent[];
  onEvent: (event: UnifiedStreamEvent) => void;
} {
  const events: UnifiedStreamEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

export function tempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
