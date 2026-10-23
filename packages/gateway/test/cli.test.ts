import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { ensureHome, readConfig, writeConfig } from '../src/home.js';
import { GATEWAY_VERSION } from '../src/version.js';
import { startTestServer } from './helpers.js';

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
    expect(lines.join('\n')).toContain('init [--dry-run]');
  });

  it('writes a project into config when no gateway is listening for this home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-cli-home-'));
    const root = await mkdtemp(path.join(tmpdir(), 'aidev-cli-root-'));
    dirs.push(home, root);
    await ensureHome(home);
    await writeConfig(home, { ...(await readConfig(home)), port: 9 });
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ['projects', 'add', root, '--origin', 'http://localhost:5173'],
      { ...process.env, AIDEV_HOME: home },
      {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      },
    );
    expect(code).toBe(0);
    const snippet = out.join('\n');
    expect(snippet).toContain('window.__AI_DEVTOOLS__');
    expect(snippet).toContain("src=\"http://127.0.0.1:9/overlay.js\" defer");
    expect(snippet).toMatch(/"browserToken":"[A-Za-z0-9_-]+"/);
    expect(snippet).toMatch(/"projectId":"[0-9a-f]+"/);
    expect(err.join('\n')).toMatch(/registered [0-9a-f]+/);
    expect(err.join('\n')).toMatch(/project-scoped and for local development only/);
    const config = await readConfig(home);
    expect(config.projects?.[0]?.root).toBe(await realpath(root));
    expect(config.projects?.[0]?.origins).toEqual(['http://localhost:5173']);
    const tokenFile = path.join(home, 'browser-tokens.json');
    const info = await stat(tokenFile);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('prints a snippet from a running gateway and requires a local origin', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-cli-live-'));
    const root = await mkdtemp(path.join(tmpdir(), 'aidev-cli-live-root-'));
    dirs.push(home, root);
    const server = await startTestServer({ home, registerDefaultRoot: false, authenticateFetch: false });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    await writeConfig(home, { ...(await readConfig(home)), port: address.port });
    try {
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(
        ['projects', 'add', root, '--origin', 'http://127.0.0.1:3000'],
        { ...process.env, AIDEV_HOME: home },
        {
          stdout: (line) => out.push(line),
          stderr: (line) => err.push(line),
        },
      );
      expect(code).toBe(0);
      const snippet = out.join('\n');
      expect(snippet).toContain(`src="http://127.0.0.1:${address.port}/overlay.js" defer`);
      expect(snippet).toContain('window.__AI_DEVTOOLS__');
      expect(err.join('\n')).not.toMatch(/Gateway is not running/);

      await expect(
        run(['projects', 'add', root], { ...process.env, AIDEV_HOME: home }, silentIo()),
      ).rejects.toThrow(/--origin is required/);
      await expect(
        run(
          ['projects', 'add', root, '--origin', 'https://evil.example'],
          { ...process.env, AIDEV_HOME: home },
          silentIo(),
        ),
      ).rejects.toThrow(/Invalid --origin/);
    } finally {
      await server.close();
    }
  });

  it('prints provider rows from doctor', async () => {
    const lines: string[] = [];
    const code = await run(['doctor'], process.env, {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('provider');
    expect(text).toContain('verified');
    expect(text).toContain('models');
    expect(text).toContain('cursor');
    expect(text).toContain('claude');
  }, 45_000);

  it('stops a detached gateway so the port is free', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-stop-home-'));
    dirs.push(home);
    const port = await freePort();
    const cli = cliPath();
    let pid: number | null = null;
    try {
      const started = await spawnDetached(cli, home, port);
      expect(started.code, started.output).toBe(0);
      pid = await readPid(home);
      expect(await healthVersion(port)).toBe(GATEWAY_VERSION);

      const statusLines: string[] = [];
      const status = await run(['status'], { ...process.env, AIDEV_HOME: home }, capture(statusLines));
      expect(status).toBe(0);
      expect(statusLines.join('\n')).toContain('running');
      expect(statusLines.join('\n')).toContain(String(port));

      const stopLines: string[] = [];
      const stopped = await run(['stop'], { ...process.env, AIDEV_HOME: home }, capture(stopLines));
      expect(stopped).toBe(0);
      expect(stopLines.join('\n')).toMatch(/stopped/);
      pid = null;
      await expectPoll(async () => !(await portAnswers(port)));
    } finally {
      await cleanupGateway(home, pid, port);
    }
  }, 30_000);

  it('stops a listening gateway through /api/v1/shutdown when the pid file is missing', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-shutdown-home-'));
    dirs.push(home);
    const server = await startTestServer({ home, authenticateFetch: false, registerDefaultRoot: false });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    await writeConfig(home, { ...(await readConfig(home)), port: address.port });
    try {
      const lines: string[] = [];
      const code = await run(['stop'], { ...process.env, AIDEV_HOME: home }, capture(lines));
      expect(code).toBe(0);
      expect(lines.join('\n')).toMatch(/stopped/);
      await expectPoll(async () => {
        try {
          await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(200) });
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      await server.close().catch(() => undefined);
    }
  });
});

function capture(lines: string[]) {
  return {
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => lines.push(line),
  };
}

function silentIo() {
  return {
    stdout: () => undefined,
    stderr: () => undefined,
  };
}

function cliPath(): string {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  if (!existsSync(cli)) {
    throw new Error('packages/gateway/dist/cli.js is missing; build @aidev/gateway first');
  }
  return cli;
}

async function spawnDetached(
  cli: string,
  home: string,
  port: number,
): Promise<{ code: number; output: string }> {
  const child = spawn(process.execPath, [cli, 'start', '--detach', '--port', String(port)], {
    env: { ...process.env, AIDEV_HOME: home, GATEWAY_LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (value) => resolve(value ?? 1));
  });
  return { code, output: Buffer.concat(chunks).toString('utf8') };
}

async function cleanupGateway(home: string, pid: number | null, port: number): Promise<void> {
  await run(['stop'], { ...process.env, AIDEV_HOME: home }, {
    stdout: () => undefined,
    stderr: () => undefined,
  }).catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  await expectPoll(async () => !(await portAnswers(port))).catch(() => undefined);
}

async function readPid(home: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(path.join(home, 'gateway.pid'), 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function healthVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

async function portAnswers(port: number): Promise<boolean> {
  return (await healthVersion(port)) !== null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not reserve a port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.once('error', reject);
  });
}

async function expectPoll(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out');
}
