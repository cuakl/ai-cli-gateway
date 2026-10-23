import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);

export interface PtySession {
  readonly id: string;
  readonly fallback: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

export interface SpawnPtyOptions {
  cwd: string;
  cols?: number;
  rows?: number;
  shell?: string;
  /** Test hook. Return null to exercise the pipe-shell fallback. */
  loadPty?: () => Promise<NodePtyModule | null>;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

interface PtyBackend {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

interface NodePtyModule {
  spawn: (
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string | undefined>;
    },
  ) => {
    onData(listener: (data: string) => void): { dispose(): void };
    onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  };
}

const sessions = new Map<string, PtySession>();

export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id);
}

/**
 * Spawn an interactive shell. `node-pty` is preferred; a piped login shell is
 * used when the native binding cannot be loaded or started.
 */
export async function spawnPty(options: SpawnPtyOptions): Promise<PtySession> {
  const shell = options.shell || process.env.SHELL || 'bash';
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;
  const cwd = options.cwd;
  const id = `pty_${randomUUID()}`;
  const forwarded: SpawnPtyOptions = {
    ...options,
    onExit(code) {
      sessions.delete(id);
      options.onExit(code);
    },
  };
  let backend: PtyBackend;
  let fallback = false;
  const loader = options.loadPty ?? loadNodePty;
  try {
    const pty = await loader();
    if (!pty) throw new Error('node-pty is unavailable');
    backend = startNodePty(pty, shell, cwd, cols, rows, forwarded);
  } catch {
    fallback = true;
    forwarded.onData('\r\n\x1b[33m[ai-devtools] node-pty is unavailable. Using a compatibility shell.\x1b[0m\r\n');
    backend = startPipeShell(shell, cwd, cols, rows, forwarded);
  }

  const session: PtySession = {
    id,
    fallback,
    write(data) {
      backend.write(data);
    },
    resize(nextCols, nextRows) {
      backend.resize(nextCols, nextRows);
    },
    dispose() {
      sessions.delete(id);
      backend.dispose();
    },
  };
  sessions.set(id, session);
  return session;
}

function startNodePty(
  pty: NodePtyModule,
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  options: SpawnPtyOptions,
): PtyBackend {
  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: shellEnv(cols, rows),
  });
  const dataSub = term.onData((data) => options.onData(data));
  const exitSub = term.onExit(({ exitCode }) => options.onExit(exitCode));
  let disposed = false;
  const termDispose = (): void => {
    if (disposed) return;
    disposed = true;
    dataSub.dispose();
    exitSub.dispose();
    try {
      term.kill();
    } catch {
      // The process has already exited.
    }
  };
  return {
    write(data) {
      term.write(data);
    },
    resize(nextCols, nextRows) {
      term.resize(nextCols, nextRows);
    },
    dispose: termDispose,
  };
}

function startPipeShell(
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  options: SpawnPtyOptions,
): PtyBackend {
  const child = spawn(shell, ['-i'], {
    cwd,
    env: shellEnv(cols, rows),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const onChunk = (chunk: Buffer): void => options.onData(chunk.toString('utf8'));
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  let exited = false;
  const finish = (code: number): void => {
    if (exited) return;
    exited = true;
    options.onExit(code);
  };
  child.on('error', (error) => {
    options.onData(`\r\n${error.message}\r\n`);
    finish(127);
  });
  child.on('exit', (code) => finish(code ?? 0));
  return {
    write(data) {
      if (!child.stdin.destroyed) child.stdin.write(data);
    },
    resize() {
      // A pipe has no terminal size to update.
    },
    dispose() {
      killChild(child);
    },
  };
}

async function loadNodePty(): Promise<NodePtyModule | null> {
  try {
    const imported = (await import('node-pty')) as NodePtyModule & { default?: NodePtyModule };
    const spawnFn = imported.spawn ?? imported.default?.spawn;
    if (typeof spawnFn !== 'function') return null;
    ensureSpawnHelper();
    return { spawn: spawnFn };
  } catch {
    return null;
  }
}

/**
 * pnpm can unpack `spawn-helper` without the executable bit, and node-pty then
 * fails with `posix_spawnp failed`. Restore the bit before the first spawn.
 */
function ensureSpawnHelper(): void {
  let root = '';
  try {
    root = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return;
  }
  const helpers = [
    path.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    path.join(root, 'build', 'Release', 'spawn-helper'),
  ];
  for (const helper of helpers) {
    try {
      chmodSync(helper, 0o755);
    } catch {
      // This candidate is not the build node-pty will load.
    }
  }
}

function shellEnv(cols: number, rows: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLUMNS = String(cols);
  env.LINES = String(rows);
  return env;
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  if (child.killed || child.exitCode !== null) return;
  child.kill('SIGHUP');
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 400);
  timer.unref();
}

