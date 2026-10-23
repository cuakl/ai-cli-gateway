#!/usr/bin/env node
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAdapter, getProviderCapabilities, type ProviderType } from '@aidev/adapters';
import { startServer } from './app.js';
import { CLI_NAME } from './brand.js';
import { ensureHome, readConfig, readMachineToken, resolveAidevHome, writeConfig } from './home.js';
import { runInit } from './init.js';
import { parseDevOrigin } from './projects/origin.js';
import { ProjectRegistry } from './projects/registry.js';
import { formatScriptTagSnippet, projectNameOf } from './projects/script-tag.js';
import { GATEWAY_VERSION } from './version.js';

const USAGE = `Usage: ${CLI_NAME} <command>

  start [--port N] [--detach]   Listen on 127.0.0.1. --detach writes a pid file and a log.
  stop                          Stop the detached gateway.
  status                        Print health, projects, and active runs.
  doctor [--live]               Print provider capabilities. --live asks each CLI to reply OK.
  init [--dry-run]              Detect the app and print or apply setup. Never installs.
  projects add [dir] --origin <url>
                                Register a project and print a script-tag snippet.
  open [--print]                 Print the dashboard URL. Opens a browser unless --print.
`;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIo: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

/** Run one CLI command. `null` means the process should stay up (foreground start). */
export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = defaultIo,
  cwd = process.cwd(),
): Promise<number | null> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(USAGE.trimEnd());
    return command ? 0 : 1;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string' },
      detach: { type: 'boolean', default: false },
      origin: { type: 'string' },
      live: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      print: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  switch (command) {
    case 'start':
      return commandStart(values.port, values.detach === true, env, io);
    case 'stop':
      return commandStop(env, io);
    case 'status':
      return commandStatus(env, io);
    case 'doctor':
      return commandDoctor(io, values.live === true);
    case 'init':
      return runInit(cwd, values['dry-run'] === true, io);
    case 'projects':
      return commandProjects(positionals, values.origin, env, io, cwd);
    case 'open':
      return commandOpen(env, io, values.print === true);
    default:
      io.stderr(`Unknown command "${command}"\n\n${USAGE.trimEnd()}`);
      return 1;
  }
}

async function commandStart(
  portFlag: string | undefined,
  detach: boolean,
  env: NodeJS.ProcessEnv,
  io: CliIo,
): Promise<number | null> {
  const home = resolveAidevHome(env);
  const ensured = await ensureHome(home);
  const port = readPort(portFlag ?? String(ensured.config.port ?? 4100));
  if (ensured.config.port !== port) {
    await writeConfig(home, { ...(await readConfig(home)), port });
  }
  if (detach) return detachStart(home, port, env, io);
  process.env.PORT = String(port);
  if (env.AIDEV_HOME) process.env.AIDEV_HOME = env.AIDEV_HOME;
  const app = await startServer();
  await writeFile(path.join(home, 'gateway.pid'), `${process.pid}\n`, { mode: 0o600 });
  // POST /api/v1/shutdown only closes the app; live PTYs or timers would keep the process up.
  app.server.once('close', () => {
    void rm(path.join(home, 'gateway.pid'), { force: true }).finally(() => process.exit(0));
  });
  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    io.stderr(`received ${signal}, closing`);
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        io.stderr(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  };
  const onSigint = (): void => shutdown('SIGINT');
  const onSigterm = (): void => shutdown('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  app.server.once('close', () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    void rm(path.join(home, 'gateway.pid'), { force: true });
  });
  return null;
}

async function detachStart(home: string, port: number, env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const logs = path.join(home, 'logs');
  await mkdir(logs, { recursive: true });
  const logPath = path.join(logs, 'gateway.log');
  const pidFile = path.join(home, 'gateway.pid');
  const fd = openSync(logPath, 'a');
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'start', '--port', String(port)], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...env, PORT: String(port), AIDEV_HOME: home },
    });
  } finally {
    closeSync(fd);
  }
  if (child.pid) await writeFile(pidFile, `${child.pid}\n`, { mode: 0o600 });
  child.unref();
  const ok = await waitForHealth(`http://127.0.0.1:${port}/health`, 5_000);
  if (!ok) {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // The child never started.
      }
    }
    await rm(pidFile, { force: true });
    io.stderr(`aidev gateway failed to start. See ${logPath}`);
    return 1;
  }
  io.stdout(`aidev gateway listening on http://127.0.0.1:${port} (pid ${child.pid ?? 'unknown'})`);
  return 0;
}

async function commandStop(env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const home = resolveAidevHome(env);
  const pidFile = path.join(home, 'gateway.pid');
  const pid = await readPidFile(pidFile);
  if (pid && alive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!alive(pid)) {
        await rm(pidFile, { force: true });
        io.stdout(`aidev gateway stopped (pid ${pid})`);
        return 0;
      }
      await delay(100);
    }
    io.stderr(`aidev gateway (pid ${pid}) did not exit`);
    return 1;
  }
  await rm(pidFile, { force: true });
  return stopViaShutdown(home, io);
}

async function readPidFile(pidFile: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

async function stopViaShutdown(home: string, io: CliIo): Promise<number> {
  let token = '';
  let port = 4100;
  try {
    token = await readMachineToken(home);
    const config = await readConfig(home);
    if (config.port) port = config.port;
  } catch {
    io.stdout('aidev gateway is not running');
    return 0;
  }
  const base = `http://127.0.0.1:${port}`;
  if (!(await healthIsOurs(`${base}/health`))) {
    io.stdout('aidev gateway is not running');
    return 0;
  }
  try {
    const response = await fetch(`${base}/api/v1/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      io.stderr(`shutdown failed (${response.status})`);
      return 1;
    }
  } catch {
    io.stdout('aidev gateway is not running');
    return 0;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await healthIsOurs(`${base}/health`))) {
      io.stdout(`aidev gateway stopped (http://127.0.0.1:${port})`);
      return 0;
    }
    await delay(100);
  }
  io.stderr(`aidev gateway on port ${port} did not exit`);
  return 1;
}

async function healthIsOurs(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string; version?: string };
    return body.status === 'ok' && body.version === GATEWAY_VERSION;
  } catch {
    return false;
  }
}

async function commandStatus(env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const home = resolveAidevHome(env);
  let token = '';
  let port = 4100;
  try {
    token = await readMachineToken(home);
    const config = await readConfig(home);
    if (config.port) port = config.port;
  } catch {
    io.stdout('aidev gateway is not running');
    return 1;
  }
  const base = `http://127.0.0.1:${port}`;
  let health: { status?: string; version?: string };
  try {
    const response = await fetch(`${base}/health`);
    if (!response.ok) throw new Error(String(response.status));
    health = (await response.json()) as { status?: string; version?: string };
  } catch {
    io.stdout('aidev gateway is not running');
    return 1;
  }
  const statusResponse = await fetch(`${base}/api/v1/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!statusResponse.ok) {
    io.stderr(`status failed (${statusResponse.status})`);
    return 1;
  }
  const body = (await statusResponse.json()) as {
    version?: string;
    activeRuns?: number;
    projects?: Array<{ name: string; id: string; root: string; origins: string[] }>;
    providers?: Array<{ provider: string; available: boolean; binaryPath: string | null }>;
  };
  io.stdout(
    formatTable([
      ['gateway', 'running', base, `v${health.version ?? body.version ?? GATEWAY_VERSION}`],
      ['active runs', String(body.activeRuns ?? 0), '', ''],
    ]),
  );
  const projects = body.projects ?? [];
  io.stdout('');
  io.stdout(
    formatTable([
      ['project', 'id', 'root', 'origins'],
      ...(projects.length > 0
        ? projects.map((project) => [project.name, project.id.slice(0, 12), project.root, project.origins.join(', ') || '-'])
        : [['-', '-', '-', '-']]),
    ]),
  );
  const providers = body.providers ?? [];
  io.stdout('');
  io.stdout(
    formatTable([
      ['provider', 'available', 'binary'],
      ...providers.map((item) => [item.provider, item.available ? 'yes' : 'no', item.binaryPath ?? '-']),
    ]),
  );
  return 0;
}

async function commandDoctor(io: CliIo, live: boolean): Promise<number> {
  io.stdout(`${CLI_NAME} ${GATEWAY_VERSION}`);
  const found = await getProviderCapabilities();
  const rows: string[][] = [['provider', 'available', 'version', 'verified', 'modes', 'models', 'binary']];
  for (const item of found) {
    rows.push([
      item.provider,
      item.available ? 'yes' : 'no',
      item.version ?? '-',
      item.verified ? 'yes' : 'no',
      item.modes.join(','),
      String(item.models.length),
      item.binaryPath ?? '-',
    ]);
  }
  io.stdout(formatTable(rows));
  if (!live) return 0;

  const probes: string[][] = [['probe', 'result', 'detail']];
  for (const item of found) {
    if (!item.available) continue;
    const probe = await probeProvider(item.provider);
    probes.push([item.provider, probe.ok ? 'pass' : 'fail', clip(probe.detail)]);
  }
  io.stdout('');
  if (probes.length === 1) {
    io.stdout('live probe: no available providers');
    return 0;
  }
  io.stdout(formatTable(probes));
  return 0;
}

async function probeProvider(provider: ProviderType): Promise<{ ok: boolean; detail: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'aidev-doctor-'));
  try {
    const adapter = createAdapter(provider);
    const errors: string[] = [];
    const result = await adapter.execute(
      {
        prompt: 'Reply with exactly: OK',
        cwd,
        mode: 'ask',
        ephemeral: true,
        timeoutMs: 180_000,
      },
      (event) => {
        if (event.type === 'error' && event.payload.error) errors.push(event.payload.error);
      },
    );
    const output = result.summary.trim();
    if (result.exitCode === 0 && output.includes('OK')) return { ok: true, detail: output };
    return { ok: false, detail: errors.join(' ') || output || `exit ${result.exitCode}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return (flat || '(no output)').slice(0, 80);
}

async function commandProjects(
  positionals: string[],
  origin: string | undefined,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  cwd: string,
): Promise<number> {
  if (positionals[0] !== 'add') {
    throw new Error(`Usage: ${CLI_NAME} projects add [dir] --origin <url>`);
  }
  if (!origin) {
    throw new Error(`--origin is required for script-tag install.\nUsage: ${CLI_NAME} projects add [dir] --origin <url>`);
  }
  const registeredOrigin = parseDevOrigin(origin);
  const root = path.resolve(cwd, positionals[1] ?? cwd);
  const home = resolveAidevHome(env);
  const ensured = await ensureHome(home);
  const port = ensured.config.port ?? 4100;
  const gatewayUrl = `http://127.0.0.1:${port}`;
  const projectName = await projectNameOf(root);

  let projectId = '';
  let browserToken = '';
  let gatewayUp = false;

  if (await waitForHealth(`${gatewayUrl}/health`, 400)) {
    const response = await fetch(`${gatewayUrl}/api/v1/projects/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ensured.token}`,
      },
      body: JSON.stringify({ root, origin: registeredOrigin }),
    });
    if (response.ok) {
      const body = (await response.json()) as { projectId?: string; browserToken?: string };
      if (typeof body.projectId === 'string' && typeof body.browserToken === 'string') {
        projectId = body.projectId;
        browserToken = body.browserToken;
        gatewayUp = true;
      }
    } else if (response.status !== 401) {
      throw new Error((await response.text()) || `register failed (${response.status})`);
    }
  }

  if (!projectId || !browserToken) {
    const registry = new ProjectRegistry(home);
    await registry.load();
    const { project, browserToken: token } = await registry.register({
      root,
      origin: registeredOrigin,
    });
    projectId = project.id;
    browserToken = token;
  }

  io.stdout(
    formatScriptTagSnippet({
      gatewayUrl,
      projectId,
      browserToken,
      projectName,
    }),
  );
  io.stderr(`registered ${projectId}`);
  io.stderr(root);
  io.stderr(
    'The browser token is project-scoped and for local development only. Do not commit it or ship it in production.',
  );
  if (!gatewayUp) {
    io.stderr('Gateway is not running. Start it with: npx aidev start');
  }
  return 0;
}

export type OpenUrlLaunch = (command: string, args: readonly string[]) => void;

let testOpenUrl: OpenUrlLaunch | undefined;

/** Tests replace `open` / `xdg-open` so a real browser is never launched. */
export function setOpenUrlHook(hook: OpenUrlLaunch | null): void {
  testOpenUrl = hook ?? undefined;
}

export function browserLaunch(url: string, platform = process.platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

async function commandOpen(env: NodeJS.ProcessEnv, io: CliIo, printOnly: boolean): Promise<number> {
  const home = resolveAidevHome(env);
  const ensured = await ensureHome(home);
  const port = ensured.config.port ?? 4100;
  const url = `http://127.0.0.1:${port}/dashboard/#token=${encodeURIComponent(ensured.token)}`;
  io.stdout(url);
  if (!printOnly) openUrl(url);
  return 0;
}

function openUrl(url: string): void {
  const { command, args } = browserLaunch(url);
  const launch = testOpenUrl ?? defaultOpenUrl;
  try {
    launch(command, args);
  } catch {
    // Opening a browser is best-effort; the URL was already printed.
  }
}

function defaultOpenUrl(command: string, args: readonly string[]): void {
  execFile(command, [...args], () => undefined);
}

function readPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port "${value}". Expected an integer from 0 to 65535.`);
  }
  return port;
}

function formatTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join('  '))
    .join('\n');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(200) });
      if (response.ok) return true;
    } catch {
      // The port is not open yet.
    }
    await delay(100);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => {
      if (code !== null) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
