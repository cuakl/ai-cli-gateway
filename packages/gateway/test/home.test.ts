import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AidevConfigSchema } from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureHome, readConfig } from '../src/home.js';

const homes: string[] = [];

describe('home directory', () => {
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates a mode 0600 token and a schema-valid config in a temp directory', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-token-'));
    homes.push(home);
    const first = await ensureHome(home);
    const info = await stat(path.join(home, 'token'));
    expect(info.mode & 0o777).toBe(0o600);
    expect(first.token.length).toBeGreaterThan(20);
    expect(await readFile(path.join(home, 'token'), 'utf8')).toContain(first.token);
    expect(AidevConfigSchema.parse(await readConfig(home)).port).toBe(4100);
    const second = await ensureHome(home);
    expect(second.token).toBe(first.token);
    expect(home.startsWith(tmpdir()) || home.startsWith('/private')).toBe(true);
  });
});
