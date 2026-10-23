import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

const fixtures = fileURLToPath(new URL('./fixtures/init', import.meta.url));
const dirs: string[] = [];

describe('aidev init', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('edits a Vite TypeScript config and prints the pnpm install command', async () => {
    const cwd = await copyFixture('vite-ts');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('pnpm add -D @aidev/vite');
    const config = await readFile(path.join(cwd, 'vite.config.ts'), 'utf8');
    expect(config).toContain(`import { aiDevtools } from '@aidev/vite';`);
    expect(config).toContain('aiDevtools()');
    expect(config).toContain('react()');
  });

  it('leaves an already-configured Vite config unchanged', async () => {
    const cwd = await copyFixture('already');
    const before = await readFile(path.join(cwd, 'vite.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/already references/);
    expect(await readFile(path.join(cwd, 'vite.config.ts'), 'utf8')).toBe(before);
  });

  it('prints manual instructions when the Vite config has no plugins array', async () => {
    const cwd = await copyFixture('no-plugins');
    const before = await readFile(path.join(cwd, 'vite.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('Could not find `plugins: [`');
    expect(text).toContain(`import { aiDevtools } from '@aidev/vite'`);
    expect(text).toContain('plugins: [aiDevtools()]');
    expect(await readFile(path.join(cwd, 'vite.config.ts'), 'utf8')).toBe(before);
  });

  it('prints a diff on --dry-run and does not write the file', async () => {
    const cwd = await copyFixture('dry-run');
    const before = await readFile(path.join(cwd, 'vite.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init', '--dry-run'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, 'vite.config.ts'), 'utf8')).toBe(before);
    const text = lines.join('\n');
    expect(text).toContain('yarn add -D @aidev/vite');
    expect(text).toContain('--- a/vite.config.ts');
    expect(text).toContain('+++ b/vite.config.ts');
    expect(text).toContain(`+import { aiDevtools } from '@aidev/vite';`);
    expect(text).toContain('aiDevtools()');
    expect(text).not.toContain('Updated vite.config.ts');
  });

  it('edits a simple Next export default object and prints the pnpm install command', async () => {
    const cwd = await copyFixture('next-ts');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('pnpm add -D @aidev/next');
    expect(text).toContain("import { AidevScript } from '@aidev/next/script'");
    expect(text).toContain('<AidevScript />');
    const config = await readFile(path.join(cwd, 'next.config.ts'), 'utf8');
    expect(config).toContain(`import { withAidev } from '@aidev/next';`);
    expect(config).toContain('export default withAidev({');
    expect(config).toContain('reactStrictMode: true');
  });

  it('edits a simple Next module.exports object', async () => {
    const cwd = await copyFixture('next-cjs');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('npm add -D @aidev/next');
    const config = await readFile(path.join(cwd, 'next.config.js'), 'utf8');
    expect(config).toContain(`const { withAidev } = require('@aidev/next');`);
    expect(config).toContain('module.exports = withAidev({');
  });

  it('prints Next wrap instructions when the config is not a plain object export', async () => {
    const cwd = await copyFixture('next-complex');
    const before = await readFile(path.join(cwd, 'next.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('yarn add -D @aidev/next');
    expect(text).toContain('is not a simple');
    expect(text).toContain(`import { withAidev } from '@aidev/next'`);
    expect(text).toContain('export default withAidev(nextConfig)');
    expect(await readFile(path.join(cwd, 'next.config.ts'), 'utf8')).toBe(before);
  });

  it('leaves an already-configured Next config unchanged', async () => {
    const cwd = await copyFixture('next-already');
    const before = await readFile(path.join(cwd, 'next.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/already references/);
    expect(await readFile(path.join(cwd, 'next.config.ts'), 'utf8')).toBe(before);
  });

  it('prints a Next diff on --dry-run and does not write the file', async () => {
    const cwd = await copyFixture('next-ts');
    const before = await readFile(path.join(cwd, 'next.config.ts'), 'utf8');
    const lines: string[] = [];
    const code = await run(['init', '--dry-run'], process.env, capture(lines), cwd);
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, 'next.config.ts'), 'utf8')).toBe(before);
    const text = lines.join('\n');
    expect(text).toContain('--- a/next.config.ts');
    expect(text).toContain('+++ b/next.config.ts');
    expect(text).toContain(`+import { withAidev } from '@aidev/next';`);
    expect(text).toContain('withAidev({');
    expect(text).not.toContain('Updated next.config.ts');
  });
});

function capture(lines: string[]) {
  return {
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => lines.push(line),
  };
}

async function copyFixture(name: string): Promise<string> {
  const dest = await mkdtemp(path.join(tmpdir(), `aidev-init-${name}-`));
  dirs.push(dest);
  await cp(path.join(fixtures, name), dest, { recursive: true });
  return dest;
}
