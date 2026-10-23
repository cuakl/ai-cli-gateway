import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  TestReportSchema,
  type TestCaseStatus,
  type TestFileResult,
  type TestReport,
} from '@aidev/protocol';

export interface TestCommand {
  command: string;
  args: string[];
}

export interface TestRunOptions {
  file?: string;
  testNamePattern?: string;
  /** Project-relative files that failed the previous run (`onlyFailed`). */
  failedFiles?: string[];
}

export interface TestRunResult {
  exitCode: number;
  command: string;
  report?: TestReport;
}

export type TestRunner = 'vitest' | 'jest';

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
  const runner = detectTestRunner(pkg);
  if (runner === 'vitest') return { command: 'npx', args: ['vitest', 'run'] };
  if (runner === 'jest') return { command: 'npx', args: ['jest'] };
  return { command: 'npm', args: ['test'] };
}

/** Vitest or Jest, from the test script or package dependencies. */
export function detectTestRunner(pkg: PackageJson): TestRunner | null {
  const script = pkg.scripts?.test ?? '';
  if (/\bvitest\b/.test(script)) return 'vitest';
  if (/\bjest\b/.test(script)) return 'jest';
  if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return 'vitest';
  if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return 'jest';
  return null;
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
  options: TestRunOptions = {},
): Promise<TestRunResult> {
  const pkg = readPackage(rootDir);
  const runner = detectTestRunner(pkg);
  const resolved = resolveTestCommand(rootDir);
  const files = resolveRunFiles(options);
  const reportDir = await mkdtemp(path.join(tmpdir(), 'aidev-test-report-'));
  const outputFile = path.join(reportDir, 'report.json');
  try {
    const args = withReporterArgs(resolved.args, runner, outputFile, {
      files,
      testNamePattern: options.testNamePattern,
    });
    const command = `${resolved.command} ${args.join(' ')}`;
    onLine(`$ ${command}`);
    const exitCode = await runProcess({
      command: resolved.command,
      args,
      cwd: rootDir,
      onLine,
      ...(signal ? { signal } : {}),
    });
    const report = await readReportFile(outputFile, rootDir);
    return report ? { exitCode, command, report } : { exitCode, command };
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
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

/**
 * Parse a Vitest or Jest JSON reporter payload into the workspace `test.finished` report.
 * Paths are rewritten relative to `projectRoot`.
 */
export function parseJsonTestReport(raw: string, projectRoot: string): TestReport | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.testResults)) return undefined;
  const files: TestFileResult[] = [];
  for (const entry of parsed.testResults) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    const tests = Array.isArray(entry.assertionResults)
      ? entry.assertionResults.flatMap((item) => {
          const test = parseAssertion(item);
          return test ? [test] : [];
        })
      : [];
    const fileStatus = fileStatusOf(entry.status, tests);
    files.push({
      path: toProjectPath(projectRoot, entry.name),
      status: fileStatus,
      tests,
    });
  }
  const counted = countTests(files);
  const durationMs = reportDurationMs(parsed, files);
  const report = {
    summary: {
      passed: numberField(parsed.numPassedTests) ?? counted.passed,
      failed: numberField(parsed.numFailedTests) ?? counted.failed,
      skipped:
        (numberField(parsed.numPendingTests) ?? 0) + (numberField(parsed.numTodoTests) ?? 0) ||
        counted.skipped,
      durationMs,
    },
    files,
  };
  const result = TestReportSchema.safeParse(report);
  return result.success ? result.data : undefined;
}

function withReporterArgs(
  args: string[],
  runner: TestRunner | null,
  outputFile: string,
  extra: { files: string[]; testNamePattern?: string },
): string[] {
  const next = [...args];
  const passthrough = runner ? reporterFlags(runner, outputFile) : [];
  if (extra.testNamePattern) passthrough.push('--testNamePattern', extra.testNamePattern);
  passthrough.push(...extra.files);
  if (passthrough.length === 0) return next;
  if (usesScriptPassthrough(next)) {
    if (!next.includes('--')) next.push('--');
    next.push(...passthrough);
    return next;
  }
  next.push(...passthrough);
  return next;
}

function reporterFlags(runner: TestRunner, outputFile: string): string[] {
  if (runner === 'vitest') {
    return ['--reporter=default', '--reporter=json', `--outputFile=${outputFile}`];
  }
  return ['--json', `--outputFile=${outputFile}`];
}

function usesScriptPassthrough(args: string[]): boolean {
  return args[0] === 'test';
}

function resolveRunFiles(options: TestRunOptions): string[] {
  if (options.failedFiles?.length) {
    if (options.file) return options.failedFiles.filter((file) => file === options.file);
    return options.failedFiles;
  }
  return options.file ? [options.file] : [];
}

async function readReportFile(outputFile: string, projectRoot: string): Promise<TestReport | undefined> {
  try {
    const raw = await readFile(outputFile, 'utf8');
    return parseJsonTestReport(raw, projectRoot);
  } catch {
    return undefined;
  }
}

function parseAssertion(value: unknown): TestFileResult['tests'][number] | undefined {
  if (!isRecord(value) || typeof value.title !== 'string') return undefined;
  const status = mapCaseStatus(value.status);
  const duration = numberField(value.duration) ?? 0;
  const fullName = typeof value.fullName === 'string' && value.fullName ? value.fullName : value.title;
  const failureMessages = Array.isArray(value.failureMessages)
    ? value.failureMessages.filter((item): item is string => typeof item === 'string')
    : [];
  const location = parseLocation(value.location);
  return {
    name: value.title,
    fullName,
    status,
    durationMs: Math.max(0, duration),
    failureMessages,
    ...(location ? { location } : {}),
  };
}

function parseLocation(value: unknown): { line: number; column: number } | undefined {
  if (!isRecord(value)) return undefined;
  const line = numberField(value.line);
  const column = numberField(value.column);
  if (line === undefined || column === undefined) return undefined;
  return { line, column };
}

function mapCaseStatus(value: unknown): TestCaseStatus {
  if (value === 'passed') return 'passed';
  if (value === 'failed') return 'failed';
  return 'skipped';
}

function fileStatusOf(raw: unknown, tests: TestFileResult['tests']): TestCaseStatus {
  if (tests.some((test) => test.status === 'failed') || raw === 'failed') return 'failed';
  if (tests.length > 0 && tests.every((test) => test.status === 'skipped')) return 'skipped';
  if (raw === 'passed' || tests.some((test) => test.status === 'passed')) return 'passed';
  return 'skipped';
}

function countTests(files: TestFileResult[]): { passed: number; failed: number; skipped: number } {
  const summary = { passed: 0, failed: 0, skipped: 0 };
  for (const file of files) {
    for (const test of file.tests) {
      summary[test.status] += 1;
    }
  }
  return summary;
}

function reportDurationMs(parsed: Record<string, unknown>, files: TestFileResult[]): number {
  let fromFiles = 0;
  let haveFileTimes = false;
  if (Array.isArray(parsed.testResults)) {
    for (const entry of parsed.testResults) {
      if (!isRecord(entry)) continue;
      const start = numberField(entry.startTime);
      const end = numberField(entry.endTime);
      if (start !== undefined && end !== undefined && end >= start) {
        fromFiles += end - start;
        haveFileTimes = true;
      }
    }
  }
  if (haveFileTimes) return Math.max(0, fromFiles);
  return files.reduce(
    (total, file) => total + file.tests.reduce((sum, test) => sum + test.durationMs, 0),
    0,
  );
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toProjectPath(projectRoot: string, absolute: string): string {
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return absolute.split(path.sep).join('/');
  }
  return relative.split(path.sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
