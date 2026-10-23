import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { ensureHome, readConfig, writeConfig } from '../src/home.js';

const dirs: string[] = [];

describe('aidev cli', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prints help', async () => {
    const lines: string[] = [];
    const code = await run(['help'], process.env, {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('projects add');
  });

  it('writes a project into config when no gateway is listening for this home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-cli-home-'));
    const root = await mkdtemp(path.join(tmpdir(), 'aidev-cli-root-'));
    dirs.push(home, root);
    await ensureHome(home);
    await writeConfig(home, { ...(await readConfig(home)), port: 9 });
    const lines: string[] = [];
    const code = await run(['projects', 'add', root], { ...process.env, AIDEV_HOME: home }, {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^registered [0-9a-f]+/);
    const config = await readConfig(home);
    expect(config.projects?.[0]?.root).toBe(await realpath(root));
  });

  it('prints provider rows from doctor', async () => {
    const lines: string[] = [];
    const code = await run(['doctor'], process.env, {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('cursor');
    expect(text).toContain('claude');
  });
});
