/**
 * Full demo loop in a throwaway git repo:
 * inspect the hero button, send the restyle prompt, watch HMR, review the diff, and commit.
 *
 * The gateway is a scripted provider, so the loop does not call a real CLI or edit this repo.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildServer } from '@gateway/server';
import { chromium, type Browser, type Page } from 'playwright';
import { createEditingRuntime } from './scripted-gateway.js';

const exec = promisify(execFile);
const demoRoot = fileURLToPath(new URL('..', import.meta.url));
const PROMPT = 'Change the hero button to purple with rounded-full styling';

interface ViteServer {
  url: string;
  child: ChildProcess;
}

async function main(): Promise<void> {
  process.env.GATEWAY_LOG_LEVEL = 'silent';
  const dir = await stageDemo();
  let gateway: Awaited<ReturnType<typeof buildServer>> | undefined;
  let browser: Browser | undefined;
  let vite: ViteServer | undefined;
  const logs: string[] = [];
  try {
    const editing = createEditingRuntime(dir);
    gateway = await buildServer({ runtime: editing.runtime });
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    const gatewayUrl = originOf(gateway);
    vite = await startVite(dir, gatewayUrl, logs);
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => {
      logs.push(`pageerror: ${error.message}\n`);
    });
    await runLoop(page, vite.url);
    const prompt = editing.prompts[0] ?? '';
    if (!prompt.includes(PROMPT)) throw new Error(`Gateway received an unexpected prompt:\n${prompt}`);
    if (!prompt.includes('hero-btn')) throw new Error('The prompt was missing the selected hero button');
    if (!prompt.includes('Hero.tsx')) throw new Error('The prompt was missing the hero source location');
    const log = await exec('git', ['log', '-1', '--format=%s'], { cwd: dir });
    if (log.stdout.trim() !== 'style(hero): purple rounded button') {
      throw new Error(`Unexpected commit subject: ${log.stdout.trim()}`);
    }
    const status = await exec('git', ['status', '--porcelain'], { cwd: dir });
    if (status.stdout.trim() !== '') throw new Error(`Working tree was not clean:\n${status.stdout}`);
    console.log(`e2e passed (${vite.url})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tail = logs.slice(-40).join('');
    throw new Error(`${message}${tail ? `\n\nServer log:\n${tail}` : ''}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (vite) {
      vite.child.kill('SIGTERM');
      await new Promise((resolve) => {
        if (vite?.child.exitCode !== null) resolve(undefined);
        else vite?.child.once('exit', () => resolve(undefined));
      });
    }
    await gateway?.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

async function runLoop(page: Page, url: string): Promise<void> {
  try {
    await exercise(page, url);
  } catch (error) {
    const overlay = await page
      .evaluate(() => document.querySelector('ai-devtools')?.shadowRoot?.textContent ?? '')
      .catch(() => '');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${overlay ? `\n\nOverlay:\n${overlay.slice(0, 2000)}` : ''}`);
  }
}

async function exercise(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Light for the long table.' }).waitFor();
  await fillNote(page);

  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.locator('#hero-btn').click();
  await page.getByText(/Hero\.tsx/).first().waitFor();
  await page.getByLabel('Prompt').fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Updating the hero button to purple.').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('#hero-btn');
      if (!(button instanceof HTMLElement)) return false;
      const style = getComputedStyle(button);
      return button.classList.contains('hero-purple') && style.backgroundColor === 'rgb(109, 40, 217)';
    },
    undefined,
    { timeout: 20_000 },
  );

  await page.getByText('The agent edited files. Review the diffs before committing.').waitFor();
  await page.getByRole('button', { name: 'Review diffs' }).click();
  await page.locator('[data-file="src/components/Hero.tsx"]').waitFor();
  await page.locator('[data-file="src/styles.css"]').waitFor();
  await page.getByLabel('Commit message').fill('style(hero): purple rounded button');
  await page.locator('[data-action="commit"]').click();
  await page.getByText(/Committed [0-9a-f]{7} on main\./).waitFor({ timeout: 20_000 });
  await page.getByText('No uncommitted changes.').waitFor();
}

async function fillNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send note', exact: true }).click();
  await page.getByText('Enter your name.').waitFor();
  await page.getByText('Enter a valid email.').waitFor();
  await page.getByText('Message should be at least 10 characters.').waitFor();
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@analytical.engine');
  await page.getByLabel('Message').fill('The ceramic lamp, please.');
  await page.getByRole('button', { name: 'Send note', exact: true }).click();
  await page.getByText("Thanks, Ada Lovelace. We'll write back.").waitFor();
}

async function stageDemo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumen-demo-'));
  try {
    await cp(path.join(demoRoot, 'src'), path.join(dir, 'src'), { recursive: true });
    await cp(path.join(demoRoot, 'index.html'), path.join(dir, 'index.html'));
    await cp(path.join(demoRoot, 'package.json'), path.join(dir, 'package.json'));
    await writeFile(path.join(dir, '.gitignore'), 'node_modules\n.vite-cache\n');
    await writeFile(path.join(dir, 'vite.config.ts'), VITE_CONFIG);
    await symlink(path.join(demoRoot, 'node_modules'), path.join(dir, 'node_modules'));
    await exec('git', ['init', '-b', 'main'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Demo E2E'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'demo-e2e@example.com'], { cwd: dir });
    await exec('git', ['add', '-A'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init demo'], { cwd: dir });
    return dir;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiDevtools } from '@ai-devtools/vite-plugin';

export default defineConfig({
  cacheDir: '.vite-cache',
  plugins: [react(), aiDevtools()],
  server: { host: '127.0.0.1', strictPort: true },
});
`;

function startVite(dir: string, gatewayUrl: string, logs: string[]): Promise<ViteServer> {
  return freePort().then((port) => {
    const viteBin = path.join(demoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: dir,
      env: { ...process.env, GATEWAY_URL: gatewayUrl, GATEWAY_LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output += text;
      logs.push(text);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const url = `http://127.0.0.1:${port}/`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Vite did not become ready at ${url}\n${output}`));
      }, 30_000);
      const fail = (code: number | null): void => {
        clearTimeout(timer);
        clearInterval(ready);
        reject(new Error(`Vite exited ${code ?? 'null'} before it was ready\n${output}`));
      };
      child.once('exit', fail);
      const ready = setInterval(() => {
        if (!output.includes('ready in') && !output.includes(url)) return;
        clearInterval(ready);
        clearTimeout(timer);
        child.removeListener('exit', fail);
        resolve({ url, child });
      }, 100);
    });
  });
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

function originOf(app: Awaited<ReturnType<typeof buildServer>>): string {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
