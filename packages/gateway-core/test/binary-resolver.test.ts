import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderType } from '@gateway/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinaryResolver, defaultProviderCandidates, isExecutable } from '../src/utils/binary.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-bin-'));
  tempDirs.push(dir);
  return dir;
}

describe('BinaryResolver', () => {
  it('detects a local binary on macOS via which', async () => {
    expect(process.platform).toBe('darwin');

    const resolver = new BinaryResolver();
    const nodePath = await resolver.which('node');
    if (!nodePath) throw new Error('expected `which node` to return a path');

    expect(nodePath.endsWith('/node')).toBe(true);
    await expect(isExecutable(nodePath)).resolves.toBe(true);
  });

  it('resolves a provider to a binary installed on this Mac', async () => {
    const resolver = new BinaryResolver({
      candidates: {
        claude: { commands: ['node'], paths: [process.execPath] },
      },
    });

    const resolved = await resolver.resolve('claude');
    expect(resolved?.endsWith('/node')).toBe(true);
    await expect(resolver.isAvailable('claude')).resolves.toBe(true);
  });

  it('lists the documented install locations for each CLI', () => {
    const home = '/Users/example';
    const candidates = defaultProviderCandidates(home);

    expect(candidates.cursor.commands).toContain('agent');
    expect(candidates.cursor.paths).toContain(join(home, '.cursor', 'bin', 'agent'));
    expect(candidates.cursor.paths).toContain('/usr/local/bin/agent');
    expect(candidates.antigravity.commands).toEqual(['agy']);
    expect(candidates.claude.commands).toEqual(['claude']);
    expect(candidates.codex.commands).toEqual(['codex']);
    expect(candidates.codex.paths).toContain('/opt/homebrew/bin/codex');
  });

  it('falls back to a common install path when which misses', async () => {
    const dir = await tempDir();
    const bin = join(dir, 'agy');
    await writeFile(bin, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });
    await chmod(bin, 0o755);

    const resolver = new BinaryResolver({
      which: async () => null,
      candidates: {
        antigravity: { commands: ['agy'], paths: [bin] },
      },
    });

    await expect(resolver.resolve('antigravity')).resolves.toBe(bin);
  });

  it('skips a common path that is not executable', async () => {
    const dir = await tempDir();
    const bin = join(dir, 'agy');
    await writeFile(bin, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o644 });
    await chmod(bin, 0o644);

    const resolver = new BinaryResolver({
      which: async () => null,
      candidates: {
        antigravity: { commands: ['agy'], paths: [bin] },
      },
    });

    await expect(resolver.resolve('antigravity')).resolves.toBeNull();
    await expect(isExecutable(bin)).resolves.toBe(false);
  });

  it('prefers an executable install path over a which hit that is not executable', async () => {
    const dir = await tempDir();
    const plain = join(dir, 'plain');
    const real = join(dir, 'agy');
    await writeFile(plain, 'not executable\n', { encoding: 'utf8', mode: 0o644 });
    await writeFile(real, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });
    await chmod(plain, 0o644);
    await chmod(real, 0o755);

    const resolver = new BinaryResolver({
      which: async () => plain,
      candidates: {
        antigravity: { commands: ['agy'], paths: [real] },
      },
    });

    await expect(resolver.resolve('antigravity')).resolves.toBe(real);
  });

  it('does not pass shell metacharacters to which', async () => {
    const which = vi.fn<(command: string) => Promise<string | null>>(async () => {
      throw new Error('which should not be called');
    });
    const resolver = new BinaryResolver({ which });

    await expect(resolver.which('agy; rm -rf /')).resolves.toBeNull();
    await expect(resolver.which('agy && whoami')).resolves.toBeNull();
    expect(which).not.toHaveBeenCalled();
  });

  it('returns null when the provider CLI is not installed', async () => {
    const resolver = new BinaryResolver({
      which: async () => null,
      candidates: {
        cursor: {
          commands: ['cursor-agent-not-installed'],
          paths: ['/usr/local/bin/cursor-agent-not-installed'],
        },
      },
    });

    await expect(resolver.resolve('cursor')).resolves.toBeNull();
    await expect(resolver.isAvailable('cursor')).resolves.toBe(false);
  });

  it('reports every provider from detectAll', async () => {
    const resolver = new BinaryResolver({
      which: async (command) => (command === 'node' ? process.execPath : null),
      candidates: {
        cursor: { commands: ['node'], paths: [] },
        antigravity: { commands: ['missing-agy'], paths: [] },
        claude: { commands: ['missing-claude'], paths: [] },
        codex: { commands: ['missing-codex'], paths: [] },
      },
    });

    const detected = await resolver.detectAll();
    const providers: ProviderType[] = ['cursor', 'antigravity', 'claude', 'codex'];
    expect(Object.keys(detected).sort()).toEqual([...providers].sort());
    expect(detected.cursor).toBe(process.execPath);
    expect(detected.antigravity).toBeNull();
    expect(detected.claude).toBeNull();
    expect(detected.codex).toBeNull();
  });
});
