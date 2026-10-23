import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTestCommand, runProcess, runTests } from '../src/workspace/test-service.js';

const roots: string[] = [];

describe('test service', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('streams process output and the exit code', async () => {
    const lines: string[] = [];
    const code = await runProcess({
      command: process.execPath,
      args: ['-e', 'console.log("hello-test"); console.error("from-stderr")'],
      cwd: process.cwd(),
      onLine: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines).toEqual(expect.arrayContaining(['hello-test', 'from-stderr']));
  });

  it('selects pnpm, npm, or vitest from the project', async () => {
    const pnpmRoot = await tempProject({ scripts: { test: 'vitest run' } }, 'pnpm-lock.yaml');
    expect(resolveTestCommand(pnpmRoot)).toEqual({ command: 'pnpm', args: ['test'] });

    const npmRoot = await tempProject({ scripts: { test: 'vitest run' } }, 'package-lock.json');
    expect(resolveTestCommand(npmRoot)).toEqual({ command: 'npm', args: ['test'] });

    const vitestRoot = await tempProject({ devDependencies: { vitest: '^3.0.0' } });
    expect(resolveTestCommand(vitestRoot)).toEqual({ command: 'npx', args: ['vitest', 'run'] });

    const watchRoot = await tempProject({ scripts: { test: 'vitest' } }, 'pnpm-lock.yaml');
    expect(resolveTestCommand(watchRoot)).toEqual({ command: 'pnpm', args: ['exec', 'vitest', 'run'] });

    const flagged = await tempProject({ scripts: { test: 'vitest --dom' } }, 'package-lock.json');
    expect(resolveTestCommand(flagged)).toEqual({ command: 'npx', args: ['vitest', 'run', '--dom'] });
  });

  it('sets CI so a watch-mode runner exits', async () => {
    const lines: string[] = [];
    const code = await runProcess({
      command: process.execPath,
      args: ['-e', 'if (process.env.CI !== "1") process.exit(2); console.log("ci-ok")'],
      cwd: process.cwd(),
      onLine: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines).toContain('ci-ok');
  });

  it('runs the resolved test command from the project root', async () => {
    const root = await tempProject({
      scripts: { test: `node -e "console.log('suite-ok')"` },
    }, 'package-lock.json');
    const lines: string[] = [];
    const result = await runTests(root, (line) => lines.push(line));
    expect(result.command).toBe('npm test');
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('suite-ok');
  });
});

async function tempProject(pkg: Record<string, unknown>, lockfile?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-devtools-tests-'));
  roots.push(dir);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
  if (lockfile) await writeFile(path.join(dir, lockfile), '');
  return dir;
}
