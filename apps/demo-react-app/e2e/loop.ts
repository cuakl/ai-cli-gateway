/**
 * Full demo loop in a throwaway git repo:
 * inspect the hero button, send the restyle prompt, watch HMR, review the diff, and commit.
 *
 * The gateway is a scripted provider, so the loop does not call a real CLI or edit this repo.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildServer } from '@aidev/gateway';
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
  let home: string | undefined;
  const logs: string[] = [];
  try {
    const editing = createEditingRuntime(dir);
    home = await mkdtemp(path.join(tmpdir(), 'aidev-e2e-home-'));
    gateway = await buildServer({ runtime: editing.runtime, root: dir, home });
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    const gatewayUrl = originOf(gateway);
    const token = (await readFile(path.join(home, 'token'), 'utf8')).trim();
    await assertSecurity(gatewayUrl, token, dir);
    vite = await startVite(dir, gatewayUrl, home, logs);
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
    await assertRunAttachment(home, editing.received.find((item) => item.prompt.includes(PROMPT))?.prompt ?? prompt);
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
    if (home) await rm(home, { recursive: true, force: true }).catch(() => undefined);
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

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.AIDEV_E2E_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

async function exercise(page: Page, url: string): Promise<void> {
  await page.addInitScript(PAGE_HOOKS);
  await page.goto(url);
  await page.getByRole('heading', { name: 'Light for the long table.' }).waitFor();
  await page.getByRole('img', { name: 'Gateway connected' }).waitFor();
  await fillNote(page);
  await exerciseThrowAndFix(page);
  await exerciseInspector(page);

  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.locator('#hero-btn').click();
  await page.getByText(/Hero\.tsx/).first().waitFor();
  await page.getByLabel('Prompt').fill(PROMPT);
  await page.evaluate(() => {
    (window as Window & { __marker?: number }).__marker = 1;
    sessionStorage.removeItem('aidev.markerAtFinish');
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => sessionStorage.getItem('aidev.markerAtFinish') === '1', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => (window as Window & { __marker?: number }).__marker !== 1, undefined, {
    timeout: 20_000,
  });
  await page.getByRole('heading', { name: 'Light for the long table.' }).waitFor();
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
  await page.waitForFunction(
    (prompt) => {
      const root = document.querySelector('ai-devtools')?.shadowRoot;
      if (!root) return false;
      const user = root.querySelector('[data-kind="user"] .user-text, .user-text');
      const assistant = root.querySelector('[data-kind="assistant"], .assistant-item');
      const textarea = root.querySelector('textarea');
      return Boolean(
        user?.textContent?.includes(prompt) &&
          assistant &&
          (assistant.textContent?.trim().length ?? 0) > 0 &&
          textarea instanceof HTMLTextAreaElement &&
          textarea.value === '',
      );
    },
    PROMPT,
    { timeout: 20_000 },
  );
  await shot(page, 'chat-after-run');

  await page.locator('[data-action="diffs"]').click();
  await page.locator('[data-action="review-scope-run"][aria-pressed="true"]').waitFor();
  await page.locator('[data-file="src/components/Hero.tsx"]').waitFor();
  await page.locator('[data-file="src/styles.css"]').waitFor();
  await page.locator('[data-file="src/components/Hero.tsx"]').click();
  await shot(page, 'review');
  await page.locator('[data-action="generate-commit"]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('ai-devtools')?.shadowRoot;
    const field = root?.querySelector('[aria-label="Commit message"]');
    return field instanceof HTMLTextAreaElement && field.value.includes('style(hero): purple rounded button');
  });
  await page.locator('[data-action="diff-view-split"]').click();
  await page.locator('.diff-split').waitFor();
  await shot(page, 'review-split');
  await page.locator('[data-action="diff-view-unified"]').click();
  await page.locator('[data-action="commit"]').click();
  await page.getByText(/Committed [0-9a-f]{7} on main\./).waitFor({ timeout: 20_000 });
  await page.getByText('No changes yet').waitFor();
  await exerciseTerminal(page);
}

async function exerciseInspector(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  const price = page.locator('strong', { hasText: '$86' });
  await price.hover();
  await page.locator('#ai-devtools-highlight-label').waitFor();
  const hoverText = await page.locator('#ai-devtools-highlight-label').textContent();
  if (!hoverText || !/CardGrid\.tsx|ProductCard/.test(hoverText)) {
    throw new Error(`Inspector hover label was missing CardGrid/ProductCard:\n${hoverText}`);
  }
  await shot(page, 'inspector-hover');

  const before = await page.locator('#ai-devtools-highlight').boundingBox();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(80);
  const after = await page.locator('#ai-devtools-highlight').boundingBox();
  if (!before || !after || after.width * after.height <= before.width * before.height) {
    throw new Error(
      `ArrowUp did not walk to a larger ancestor (before ${JSON.stringify(before)} after ${JSON.stringify(after)})`,
    );
  }
  await page.keyboard.press('ArrowDown');
  await price.click();
  await page.getByText(/CardGrid\.tsx/).first().waitFor();

  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.locator('strong', { hasText: '$42' }).click({ modifiers: ['Shift'] });
  await page.waitForFunction(() => {
    const root = document.querySelector('ai-devtools')?.shadowRoot;
    return (root?.querySelectorAll('[data-chip="selection"]').length ?? 0) >= 2;
  });

  await page.keyboard.press('Escape');
  const preview = page.locator('[data-action="screenshot-preview"]');
  if ((await preview.count()) > 0) {
    await preview.first().click();
    await page.locator('[data-action="annotate-screenshot"]').click();
  } else {
    await page.locator('[data-action="screenshot-element"]').click();
  }
  try {
    await page.locator('[data-action="annotate-layer"]').waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const root = document.querySelector('ai-devtools')?.shadowRoot;
        const image = root?.querySelector('.annotate-image');
        if (!(image instanceof HTMLImageElement)) return false;
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
      undefined,
      { timeout: 10_000 },
    );
    await page.locator('[data-action="annotate-arrow"]').click();
    const canvas = page.locator('.annotate-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(box.width - 20, 180), box.y + Math.min(box.height - 20, 120));
      await page.mouse.up();
    }
    await shot(page, 'annotate');
    await page.locator('[data-action="annotate-attach"]').click();
    await page.locator('[data-action="annotate-layer"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  } catch (error) {
    await shot(page, 'annotate');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Annotation layer did not open after Element screenshot:\n${message}`);
  }
}

async function assertRunAttachment(home: string, prompt: string): Promise<void> {
  const root = path.join(home, 'attachments');
  if (!existsSync(root)) throw new Error(`No attachments directory under ${root}`);
  const runs = await readdir(root);
  if (runs.length === 0) throw new Error(`No run folders under ${root}`);
  let filePath = '';
  for (const runId of runs) {
    const dir = path.join(root, runId);
    const files = await readdir(dir).catch(() => []);
    const image = files.find((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));
    if (image) {
      filePath = path.join(dir, image);
      break;
    }
  }
  if (!filePath) throw new Error(`No attachment image under ${root}/${runs.join(',')}`);
  if (!prompt.includes(filePath) && !prompt.includes('attachments')) {
    throw new Error(`CLI prompt was missing the attachment path ${filePath}:\n${prompt}`);
  }
}

async function exerciseThrowAndFix(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Throw', exact: true }).click();
  await page.waitForFunction(
    () => {
      const root = document.querySelector('ai-devtools')?.shadowRoot;
      const badge = root?.querySelector('[data-action="error-badge"]');
      const count = Number(badge?.getAttribute('data-count') ?? badge?.textContent ?? '0');
      return count >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );
  await page.locator('[data-action="error-badge"]').click();
  await page.locator('section[aria-label="Console"]').waitFor();
  await shot(page, 'console');
  await page.getByRole('button', { name: 'Fix with AI', exact: true }).first().click();
  await page.getByLabel('Prompt').waitFor();
  await page.waitForFunction(() => {
    const root = document.querySelector('ai-devtools')?.shadowRoot;
    const textarea = root?.querySelector('textarea');
    const chip = root?.querySelector('[data-chip="console"], [data-chip="vite"]');
    return textarea instanceof HTMLTextAreaElement && textarea.value === 'Fix this error' && Boolean(chip);
  });
  await shot(page, 'fix-with-ai');
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
import { aiDevtools } from '@aidev/vite';

const gatewayUrl = process.env.GATEWAY_URL;

export default defineConfig({
  cacheDir: '.vite-cache',
  plugins: [react(), aiDevtools({ autoStart: false, ...(gatewayUrl ? { gatewayUrl } : {}) })],
  server: { host: '127.0.0.1', strictPort: true },
});
`;

const PAGE_HOOKS = `
  const Native = window.WebSocket;
  function Wrapped(url, protocols) {
    const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      if (data.includes('"run.finished"')) {
        try { sessionStorage.setItem('aidev.markerAtFinish', String(window.__marker ?? '')); } catch (error) {}
      }
      if (!data.includes('"pty.data"')) return;
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.type === 'pty.data' && typeof parsed.data === 'string') {
          window.__ptyText = (window.__ptyText || '') + parsed.data;
        }
      } catch (error) {}
    });
    return socket;
  }
  Wrapped.prototype = Native.prototype;
  Wrapped.CONNECTING = Native.CONNECTING;
  Wrapped.OPEN = Native.OPEN;
  Wrapped.CLOSING = Native.CLOSING;
  Wrapped.CLOSED = Native.CLOSED;
  window.WebSocket = Wrapped;
`;

function startVite(dir: string, gatewayUrl: string, home: string, logs: string[]): Promise<ViteServer> {
  return freePort().then((port) => {
    const viteBin = path.join(demoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: dir,
      env: { ...process.env, AIDEV_HOME: home, GATEWAY_URL: gatewayUrl, GATEWAY_LOG_LEVEL: 'silent' },
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

async function exerciseTerminal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const screen = page.locator('.xterm');
  await screen.waitFor();
  await screen.click();
  await page.keyboard.type('echo hi');
  await page.keyboard.press('Enter');
  try {
    await page.waitForFunction(
      () => {
        const raw = (window as Window & { __ptyText?: string }).__ptyText ?? '';
        const text = raw
          .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
          .replace(/\u001b[=>]/g, '');
        const at = text.lastIndexOf('echo hi');
        return at >= 0 && /(?:^|[\r\n])hi(?:\r|\n)/.test(text.slice(at + 'echo hi'.length));
      },
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    const text = await page.evaluate(() => (window as Window & { __ptyText?: string }).__ptyText ?? '');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\npty data:\n${JSON.stringify(text)}`);
  }
  await page.evaluate(() => {
    const el = document.querySelector('ai-devtools')?.shadowRoot?.querySelector('.xterm');
    if (!(el instanceof HTMLElement)) throw new Error('Terminal did not render');
    el.dataset.e2e = 'kept';
  });
  await page.getByRole('button', { name: 'Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.evaluate(() => {
    const root = document.querySelector('ai-devtools')?.shadowRoot;
    const section = root?.querySelector('section[aria-label="Terminal"]');
    const el = root?.querySelector('.xterm');
    if (!(section instanceof HTMLElement) || section.hidden) throw new Error('Terminal is not visible');
    if (!(el instanceof HTMLElement) || el.dataset.e2e !== 'kept') throw new Error('Terminal was recreated');
    const raw = (window as Window & { __ptyText?: string }).__ptyText ?? '';
    const text = raw
      .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b[=>]/g, '');
    const at = text.lastIndexOf('echo hi');
    if (at < 0 || !/(?:^|[\r\n])hi(?:\r|\n)/.test(text.slice(at + 'echo hi'.length))) {
      throw new Error(`Terminal lost the echo hi output:\n${text}`);
    }
    if (el.innerText.trim() && !el.innerText.includes('hi')) {
      throw new Error(`Terminal text did not include hi:\n${el.innerText}`);
    }
  });
  await page.locator('[data-action="close-terminal"]').click();
}

async function assertSecurity(gatewayUrl: string, token: string, root: string): Promise<void> {
  const evil = await fetch(`${gatewayUrl}/api/v1/projects/register`, {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ root }),
  });
  const allowed = evil.headers.get('access-control-allow-origin');
  if (allowed) throw new Error(`POST with Origin https://evil.example set Access-Control-Allow-Origin: ${allowed}`);

  const upgrade = await wsUpgrade(
    `${gatewayUrl.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`,
    'https://evil.example',
  );
  if (upgrade.upgraded) throw new Error('WebSocket upgrade with Origin https://evil.example was accepted');
  if (upgrade.status !== 403) {
    throw new Error(`Expected the evil Origin upgrade to be rejected with 403, got ${upgrade.status}`);
  }

  const anonymous = await fetch(`${gatewayUrl}/api/v1/status`);
  if (anonymous.status !== 401) throw new Error(`Expected a request without a token to be 401, got ${anonymous.status}`);
}

function wsUpgrade(url: string, origin: string): Promise<{ status: number; upgraded: boolean }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
        origin,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode ?? 101, upgraded: true });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, upgraded: false });
    });
    req.on('error', reject);
    req.end();
  });
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

main()
  .then(() => {
    // The in-process gateway PTY keeps Node's event loop alive after the script returns.
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
