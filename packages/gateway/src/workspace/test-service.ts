import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface TestCommand {
  command: string;
  args: string[];
}

export interface TestRunResult {
  exitCode: number;
  command: string;
}

interface PackageJson {
  scripts?: { test?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Pick `pnpm test`, `npm test`, or `npx vitest run` from the project lockfile and package.json.
 */
export function resolveTestCommand(rootDir: string): TestCommand {
  const pkg = readPackage(rootDir);
  const script = pkg.scripts?.test?.trim() ?? '';
  const manager = findPackageManager(rootDir);
  if (script) {
    const forced = forceVitestRun(script);
    if (forced) return packageExec(manager, forced);
    if (manager === 'pnpm') return { command: 'pnpm', args: ['test'] };
    if (manager === 'yarn') return { command: 'yarn', args: ['test'] };
    if (manager === 'npm') return { command: 'npm', args: ['test'] };
    return { command: 'pnpm', args: ['test'] };
  }
  const usesVitest = Boolean(pkg.devDependencies?.vitest || pkg.dependencies?.vitest);
  if (usesVitest) return { command: 'npx', args: ['vitest', 'run'] };
  return { command: 'npm', args: ['test'] };
}

/**
 * A test script that is plain `vitest` (no `run`) would start watch mode.
 * Rewrite it to `vitest run` plus any flags that followed the binary.
 * Returns null when the script should be left to the package manager.
 */
export function forceVitestRun(script: string): string[] | null {
  const parts = script.split(/\s+/).filter(Boolean);
  const bin = parts[0]?.split('/').pop();
  if (bin !== 'vitest') return null;
  if (parts.includes('run')) return null;
  return ['vitest', 'run', ...parts.slice(1)];
}

function packageExec(manager: 'pnpm' | 'npm' | 'yarn' | null, args: string[]): TestCommand {
  if (manager === 'pnpm') return { command: 'pnpm', args: ['exec', ...args] };
  if (manager === 'yarn') return { command: 'yarn', args: ['exec', ...args] };
  return { command: 'npx', args };
}

/** Run the project's test script and stream each output line. */
export async function runTests(
  rootDir: string,
  onLine: (line: string) => void,
  signal?: AbortSignal,
  file?: string,
): Promise<TestRunResult> {
  const resolved = resolveTestCommand(rootDir);
  const args = [...resolved.args];
  if (file) {
    if (args[0] === 'test') args.push('--', file);
    else args.push(file);
  }
  const command = `${resolved.command} ${args.join(' ')}`;
  onLine(`$ ${command}`);
  const exitCode = await runProcess({
    command: resolved.command,
    args,
    cwd: rootDir,
    onLine,
    ...(signal ? { signal } : {}),
  });
  return { exitCode, command };
}

export function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  onLine: (line: string) => void;
  signal?: AbortSignal;
}): Promise<number> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve(130);
      return;
    }
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    const emit = createLineEmitter(options.onLine);
    child.stdout.on('data', (chunk: Buffer) => emit(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => emit(chunk.toString('utf8')));
    child.on('error', (error) => {
      options.onLine(error.message);
      finish(127);
    });
    child.on('close', (code) => {
      emit.flush();
      finish(code ?? 1);
    });
    options.signal?.addEventListener(
      'abort',
      () => {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 400);
        timer.unref();
      },
      { once: true },
    );
  });
}

function findPackageManager(rootDir: string): 'pnpm' | 'npm' | 'yarn' | null {
  let dir = path.resolve(rootDir);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(dir, 'pnpm-lock.yaml')) || existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return 'pnpm';
    }
    if (existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
    if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackage(rootDir: string): PackageJson {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

function createLineEmitter(onLine: (line: string) => void): ((chunk: string) => void) & { flush(): void } {
  let buffer = '';
  const emit = (chunk: string): void => {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';
    for (const line of parts) onLine(line);
  };
  emit.flush = (): void => {
    if (!buffer) return;
    onLine(buffer);
    buffer = '';
  };
  return emit;
}
