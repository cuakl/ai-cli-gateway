import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
export type Framework = 'vite' | 'next' | 'plain';

export interface InitIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] as const;
const NEXT_CONFIGS = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'] as const;
const LOCKFILES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
];
const IMPORT_LINE = `import { aiDevtools } from '@aidev/vite';`;
const NEXT_IMPORT_LINE = `import { withAidev } from '@aidev/next';`;
const NEXT_REQUIRE_LINE = `const { withAidev } = require('@aidev/next');`;
const DEFAULT_GATEWAY = 'http://127.0.0.1:4100';

/** Detect the lockfile, framework, and (for Vite/Next) optionally edit the config. Never installs. */
export async function runInit(cwd: string, dryRun: boolean, io: InitIo): Promise<number> {
  const root = path.resolve(cwd);
  const manager = detectPackageManager(root);
  const framework = detectFramework(root);
  io.stdout(`Detected ${manager} and ${frameworkLabel(framework)}.`);
  io.stdout('');

  if (framework === 'vite') {
    return initVite(root, manager, dryRun, io);
  }
  if (framework === 'next') {
    return initNext(root, manager, dryRun, io);
  }
  printScriptTagInstructions(io);
  return 0;
}

export function detectPackageManager(root: string): PackageManager {
  for (const item of LOCKFILES) {
    if (existsSync(path.join(root, item.file))) return item.manager;
  }
  return 'npm';
}

export function detectFramework(root: string): Framework {
  if (VITE_CONFIGS.some((name) => existsSync(path.join(root, name)))) return 'vite';
  if (NEXT_CONFIGS.some((name) => existsSync(path.join(root, name)))) return 'next';
  return 'plain';
}

export function installCommand(manager: PackageManager, pkg = '@aidev/vite'): string {
  return `${manager} add -D ${pkg}`;
}

export function editViteConfig(source: string): { next: string; reason?: 'already' | 'no-plugins' } {
  if (/@aidev\/vite|\baiDevtools\b/.test(source)) return { next: source, reason: 'already' };
  const withPlugin = insertPluginCall(source);
  if (withPlugin === null) return { next: source, reason: 'no-plugins' };
  return { next: insertLineAtTop(withPlugin, IMPORT_LINE) };
}

export function editNextConfig(source: string): { next: string; reason?: 'already' | 'complex' } {
  if (/@aidev\/next|\bwithAidev\b/.test(source)) return { next: source, reason: 'already' };
  const esm = /export\s+default\s+\{/.exec(source);
  const cjs = /module\.exports\s*=\s*\{/.exec(source);
  const match =
    esm && cjs ? (esm.index <= cjs.index ? esm : cjs) : (esm ?? cjs);
  if (!match || match.index === undefined) return { next: source, reason: 'complex' };
  const kind = esm && match.index === esm.index ? 'esm' : 'cjs';
  const openBrace = match.index + match[0].length - 1;
  const closeBrace = matchingBrace(source, openBrace);
  if (closeBrace < 0) return { next: source, reason: 'complex' };
  if (!isTrailingNoise(source.slice(closeBrace + 1))) return { next: source, reason: 'complex' };
  const prefix = kind === 'esm' ? 'export default withAidev(' : 'module.exports = withAidev(';
  const wrapped = `${source.slice(0, match.index)}${prefix}${source.slice(openBrace, closeBrace + 1)})${source.slice(closeBrace + 1)}`;
  return {
    next: kind === 'esm' ? insertLineAtTop(wrapped, NEXT_IMPORT_LINE) : insertLineAtTop(wrapped, NEXT_REQUIRE_LINE),
  };
}

function initVite(root: string, manager: PackageManager, dryRun: boolean, io: InitIo): Promise<number> {
  io.stdout('Install the plugin (not run automatically):');
  io.stdout(`  ${installCommand(manager)}`);
  io.stdout('');
  const configName = VITE_CONFIGS.find((name) => existsSync(path.join(root, name)));
  if (!configName) {
    printViteManual(io);
    return Promise.resolve(0);
  }
  return editViteConfigFile(path.join(root, configName), configName, dryRun, io);
}

function initNext(root: string, manager: PackageManager, dryRun: boolean, io: InitIo): Promise<number> {
  io.stdout('Install the helper (not run automatically):');
  io.stdout(`  ${installCommand(manager, '@aidev/next')}`);
  io.stdout('');
  printNextLayout(io);
  io.stdout('');
  const configName = NEXT_CONFIGS.find((name) => existsSync(path.join(root, name)));
  if (!configName) {
    io.stdout('Wrap next.config with withAidev:');
    io.stdout('');
    printNextManual(io);
    return Promise.resolve(0);
  }
  return editNextConfigFile(path.join(root, configName), configName, dryRun, io);
}

async function editNextConfigFile(
  file: string,
  name: string,
  dryRun: boolean,
  io: InitIo,
): Promise<number> {
  const source = await readFile(file, 'utf8');
  const edited = editNextConfig(source);
  if (edited.reason === 'already') {
    io.stdout(`${name} already references @aidev/next. No changes.`);
    return 0;
  }
  if (edited.reason === 'complex') {
    io.stdout(
      `${name} is not a simple \`export default {…}\` / \`module.exports = {…}\`. Wrap it by hand:`,
    );
    io.stdout('');
    printNextManual(io);
    return 0;
  }
  if (dryRun) {
    io.stdout(formatDiff(name, source, edited.next));
    return 0;
  }
  await writeFile(file, edited.next, 'utf8');
  io.stdout(`Updated ${name}`);
  return 0;
}

async function editViteConfigFile(
  file: string,
  name: string,
  dryRun: boolean,
  io: InitIo,
): Promise<number> {
  const source = await readFile(file, 'utf8');
  const edited = editViteConfig(source);
  if (edited.reason === 'already') {
    io.stdout(`${name} already references @aidev/vite. No changes.`);
    return 0;
  }
  if (edited.reason === 'no-plugins') {
    io.stdout(`Could not find \`plugins: [\` in ${name}. Add the plugin by hand:`);
    io.stdout('');
    printViteManual(io);
    return 0;
  }
  if (dryRun) {
    io.stdout(formatDiff(name, source, edited.next));
    return 0;
  }
  await writeFile(file, edited.next, 'utf8');
  io.stdout(`Updated ${name}`);
  return 0;
}

function insertLineAtTop(source: string, statement: string): string {
  const line = `${statement}\n`;
  if (source.startsWith('#!')) {
    const nl = source.indexOf('\n');
    if (nl === -1) return `${source}\n${line}`;
    return `${source.slice(0, nl + 1)}${line}${source.slice(nl + 1)}`;
  }
  return `${line}${source}`;
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      i = newline === -1 ? source.length : newline;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isTrailingNoise(after: string): boolean {
  const trimmed = after.replace(/^\s*;?\s*/, '');
  if (!trimmed) return true;
  return /^(\s*\/\/[^\n]*\n?|\s*\/\*[\s\S]*?\*\/\s*)*$/.test(trimmed);
}

function insertPluginCall(source: string): string | null {
  const match = /plugins:\s*\[/.exec(source);
  if (!match || match.index === undefined) return null;
  const insertAt = match.index + match[0].length;
  const after = source.slice(insertAt);
  if (after.trimStart().startsWith(']')) {
    return `${source.slice(0, insertAt)}aiDevtools()${after}`;
  }
  const indented = /^(\r?\n)([ \t]*)/.exec(after);
  if (indented) {
    return `${source.slice(0, insertAt)}${indented[1]}${indented[2]}aiDevtools(),${after}`;
  }
  return `${source.slice(0, insertAt)}aiDevtools(), ${after}`;
}

function formatDiff(filename: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const removed = a.slice(start, endA + 1);
  const added = b.slice(start, endB + 1);
  const hunk = `@@ -${start + 1},${Math.max(removed.length, 1)} +${start + 1},${Math.max(added.length, 1)} @@`;
  return [
    `--- a/${filename}`,
    `+++ b/${filename}`,
    hunk,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

function printViteManual(io: InitIo): void {
  io.stdout('import { defineConfig } from \'vite\';');
  io.stdout(`import { aiDevtools } from '@aidev/vite';`);
  io.stdout('');
  io.stdout('export default defineConfig({');
  io.stdout('  plugins: [aiDevtools()],');
  io.stdout('});');
}

function printNextLayout(io: InitIo): void {
  io.stdout('Add <AidevScript /> to the App Router root layout (app/layout.tsx):');
  io.stdout('');
  io.stdout("import { AidevScript } from '@aidev/next/script';");
  io.stdout('');
  io.stdout('export default function RootLayout({ children }: { children: React.ReactNode }) {');
  io.stdout('  return (');
  io.stdout('    <html lang="en">');
  io.stdout('      <body>');
  io.stdout('        {children}');
  io.stdout('        <AidevScript />');
  io.stdout('      </body>');
  io.stdout('    </html>');
  io.stdout('  );');
  io.stdout('}');
}

function printNextManual(io: InitIo): void {
  io.stdout("import { withAidev } from '@aidev/next';");
  io.stdout('');
  io.stdout('const nextConfig = {');
  io.stdout('  // existing options');
  io.stdout('};');
  io.stdout('');
  io.stdout('export default withAidev(nextConfig);');
}

function printScriptTagInstructions(io: InitIo): void {
  io.stdout('This project is not Vite or Next.js. Load the overlay from the gateway with a script tag.');
  io.stdout('Do not install @aidev/vite or @aidev/next.');
  io.stdout('');
  io.stdout('  npx aidev start');
  io.stdout('  npx aidev projects add . --origin http://localhost:5173');
  io.stdout('');
  io.stdout('Paste the snippet that command prints into the document <head>.');
  io.stdout('It sets window.__AI_DEVTOOLS__ (gateway URL, project id, browser token, name)');
  io.stdout(`and loads ${DEFAULT_GATEWAY}/overlay.js. The token is project-scoped and for local development only.`);
}

function frameworkLabel(framework: Framework): string {
  if (framework === 'vite') return 'Vite';
  if (framework === 'next') return 'Next.js';
  return 'a plain app';
}
