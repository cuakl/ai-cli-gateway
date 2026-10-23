import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig, ViteDevServer } from 'vite';
import { ensureGateway, gatewayStartHint } from '../src/companion.js';
import aiDevtools, { CONFIG_PATH, type DevtoolsPluginOptions } from '../src/index.js';

const spawnMock = vi.hoisted(() => vi.fn());
const { Socket } = vi.hoisted(() => {
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
  class Socket extends Emitter {
    static instances: Socket[] = [];
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
      Socket.instances.push(this);
    }
    close(): void {
      this.emit('close');
    }
  }
  return { Socket };
});

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('ws', () => ({ WebSocket: Socket, default: Socket }));

interface Middleware {
  (req: { url?: string; method?: string }, res: FakeResponse, next: () => void): void;
}

interface FakeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: unknown): void;
}

const temps: string[] = [];
const closers: EventEmitter[] = [];

describe('gateway companion', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({ unref: vi.fn(), on: vi.fn(), pid: 1 }));
    Socket.instances = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const server of closers.splice(0)) server.emit('close');
    Socket.instances = [];
    warn.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.AIDEV_HOME;
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('registers when the gateway is already up and does not spawn', async () => {
    const root = await tempProject();
    const registrations: Array<{ root?: string; origin?: string; authorization: string | null }> = [];
    stubFetch({
      health: 'up',
      onRegister(body, authorization) {
        registrations.push({ ...body, authorization });
      },
    });
    const harness = boot(root, { gatewayUrl: 'http://127.0.0.1:4100', autoStart: true });
    const response = await request(harness.middlewares, CONFIG_PATH);
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { projectId?: string; browserToken?: string; gatewayUrl?: string; projectName?: string };
    expect(body).toMatchObject({
      gatewayUrl: 'http://127.0.0.1:4100',
      projectId: 'proj_1',
      browserToken: 'tok_browser',
      projectName: 'demo-app',
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(registrations[0]).toMatchObject({
      root,
      origin: 'http://127.0.0.1:5173',
      authorization: 'Bearer machine-token',
    });
    expect(Socket.instances[0]?.url).toContain('/api/v1/projects/proj_1/ws');
    expect(Socket.instances[0]?.url).toContain('token=machine-token');
  });

  it('spawns aidev start --detach when /health fails, then registers', async () => {
    const root = await tempProject();
    stubFetch({ health: 'down-then-up' });
    const harness = boot(root, { autoStart: true });
    const response = await request(harness.middlewares, CONFIG_PATH);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ projectId: 'proj_1', browserToken: 'tok_browser' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0];
    expect(call?.[0]).toBe(process.execPath);
    expect(call?.[1]).toEqual([
      expect.stringMatching(/[/\\]dist[/\\]cli\.js$/),
      'start',
      '--detach',
      '--port',
      '4100',
    ]);
    expect(call?.[2]).toEqual(expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(warn).not.toHaveBeenCalled();

    const html = await transformHtml(harness.plugin);
    expect(Array.isArray(html)).toBe(true);
    const tags = html as { tag?: string; injectTo?: string; attrs?: Record<string, string>; children?: string }[];
    expect(tags[0]).toMatchObject({
      tag: 'script',
      injectTo: 'head-prepend',
      attrs: { 'data-ai-devtools': 'early' },
    });
    expect(tags[0]?.children).toContain('__AI_DEVTOOLS_EARLY__');
    const script = scriptText(html);
    expect(script).toContain('"projectId":"proj_1"');
    expect(script).toContain('"browserToken":');
    expect(script).not.toContain('wsToken');
    expect(script).not.toContain('"cwd"');
  });

  it('re-registers on each config request so a restart gets a new browser token', async () => {
    const root = await tempProject();
    stubFetch({ health: 'up', tokens: ['tok_a', 'tok_b', 'tok_c', 'tok_d'] });
    const harness = boot(root, { autoStart: false });
    const first = JSON.parse((await request(harness.middlewares, CONFIG_PATH)).body) as { browserToken?: string };
    const second = JSON.parse((await request(harness.middlewares, CONFIG_PATH)).body) as { browserToken?: string };
    expect(first.browserToken).toEqual(expect.any(String));
    expect(second.browserToken).toEqual(expect.any(String));
    expect(second.browserToken).not.toBe(first.browserToken);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('logs the start command and does not spawn when autoStart is false', async () => {
    const root = await tempProject();
    stubFetch({ health: 'down' });
    const harness = boot(root, { autoStart: false, gatewayUrl: 'http://127.0.0.1:4100' });
    const response = await request(harness.middlewares, CONFIG_PATH);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      gatewayUrl: 'http://127.0.0.1:4100',
      projectName: 'demo-app',
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(gatewayStartHint('http://127.0.0.1:4100'));
    expect(String(warn.mock.calls[0]?.[0])).toContain('npx aidev start');
  });

  it('logs the start command when spawning the gateway throws', async () => {
    const root = await tempProject();
    stubFetch({ health: 'down' });
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    const harness = boot(root, { autoStart: true });
    const response = await request(harness.middlewares, CONFIG_PATH);
    expect(response.status).toBe(503);
    expect(spawnMock).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('npx aidev start'));
  });

  it('logs the start command when the spawned gateway never becomes healthy', async () => {
    const log = vi.fn();
    const ok = await ensureGateway({
      gatewayUrl: 'http://127.0.0.1:9',
      autoStart: true,
      fetchImpl: vi.fn(async () => new Response('no', { status: 503 })),
      spawnImpl: spawnMock as unknown as typeof import('node:child_process').spawn,
      resolveBin: () => '/tmp/aidev.js',
      deadlineMs: 40,
      log,
    });
    expect(ok).toBe(false);
    expect(spawnMock).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('npx aidev start'));
  });

  it('holds full reloads while project.activity reports active runs', async () => {
    const root = await tempProject();
    stubFetch({ health: 'up' });
    const harness = boot(root, { autoStart: false });
    expect((await request(harness.middlewares, CONFIG_PATH)).status).toBe(200);
    const socket = Socket.instances[0];
    expect(socket).toBeTruthy();

    vi.useFakeTimers();
    socket?.emit('message', JSON.stringify({ type: 'project.activity', activeRuns: 1 }));
    harness.ws.send({ type: 'full-reload', path: 'index.html' });
    harness.ws.send({ type: 'update', updates: ['src/App.tsx'] });
    expect(harness.sent).toEqual([{ type: 'update', updates: ['src/App.tsx'] }]);

    socket?.emit('message', JSON.stringify({ type: 'project.activity', activeRuns: 0 }));
    await vi.advanceTimersByTimeAsync(249);
    expect(harness.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.sent).toEqual([
      { type: 'update', updates: ['src/App.tsx'] },
      { type: 'full-reload', path: 'index.html' },
    ]);
  });

  it('reconnects the activity socket once after the gateway drops', async () => {
    const root = await tempProject();
    stubFetch({ health: 'up' });
    const harness = boot(root, { autoStart: false });
    expect((await request(harness.middlewares, CONFIG_PATH)).status).toBe(200);
    expect(Socket.instances).toHaveLength(1);
    Socket.instances[0]?.emit('error', new Error('gateway down'));
    Socket.instances[0]?.emit('close');
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(Socket.instances).toHaveLength(2);
    expect(Socket.instances[1]?.url).toContain('token=machine-token');
  });
});

function boot(root: string, options: DevtoolsPluginOptions) {
  const sent: unknown[] = [];
  const ws = {
    send(payload: unknown) {
      sent.push(payload);
    },
  };
  const middlewares: Middleware[] = [];
  const httpServer = new EventEmitter() as EventEmitter & {
    listening: boolean;
    address: () => { port: number; address: string; family: string };
  };
  httpServer.listening = true;
  httpServer.address = () => ({ port: 5173, address: '127.0.0.1', family: 'IPv4' });
  closers.push(httpServer);
  const plugin = aiDevtools(options);
  const resolved = plugin.configResolved;
  if (typeof resolved !== 'function') throw new Error('configResolved missing');
  resolved.call({} as never, {
    command: 'serve',
    root,
    base: '/',
    plugins: [plugin],
  } as unknown as ResolvedConfig);
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('configureServer missing');
  configure.call({} as never, {
    config: {
      root,
      base: '/',
      server: { middlewareMode: false, host: '127.0.0.1', port: 5173 },
    },
    httpServer,
    ws,
    middlewares: {
      use(fn: Middleware) {
        middlewares.push(fn);
      },
    },
  } as unknown as ViteDevServer);
  return { plugin, sent, ws, middlewares, httpServer };
}

function stubFetch(options: {
  health: 'up' | 'down' | 'down-then-up';
  tokens?: string[];
  onRegister?: (body: { root?: string; origin?: string }, authorization: string | null) => void;
}): void {
  let healthCalls = 0;
  let tokenIndex = 0;
  const tokens = options.tokens ?? ['tok_browser'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const href = input instanceof URL ? input.href : String(input);
      if (href.endsWith('/health')) {
        healthCalls += 1;
        const up = options.health === 'up' || (options.health === 'down-then-up' && healthCalls > 1);
        if (!up) return new Response('down', { status: 503 });
        return new Response(JSON.stringify({ status: 'ok', version: '0.0.1' }), { status: 200 });
      }
      if (href.includes('/api/v1/projects/register')) {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body ?? '{}')) as { root?: string; origin?: string };
        options.onRegister?.(body, headers.get('authorization'));
        const browserToken = tokens[Math.min(tokenIndex, tokens.length - 1)] ?? 'tok_browser';
        tokenIndex += 1;
        return new Response(JSON.stringify({ projectId: 'proj_1', browserToken }), { status: 200 });
      }
      return new Response('missing', { status: 404 });
    }),
  );
}

async function transformHtml(plugin: ReturnType<typeof aiDevtools>): Promise<unknown> {
  const transform = plugin.transformIndexHtml;
  const handler =
    transform && typeof transform === 'object' && 'handler' in transform ? transform.handler : transform;
  if (typeof handler !== 'function') throw new Error('transformIndexHtml missing');
  return handler.call({} as never, '<!doctype html><html><head></head><body></body></html>', {} as never);
}

function scriptText(result: unknown): string {
  if (!Array.isArray(result)) throw new Error('expected HTML tag descriptors');
  const scripts = result.filter(
    (tag) => tag && typeof tag === 'object' && 'children' in tag && typeof tag.children === 'string',
  ) as { children: string }[];
  const config = scripts.find((tag) => tag.children.includes('__AI_DEVTOOLS__='));
  return config?.children ?? scripts[0]?.children ?? '';
}

function request(middlewares: Middleware[], url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = { url, method: 'GET' };
    const res: FakeResponse = {
      statusCode: 200,
      setHeader() {},
      end(chunk?: unknown) {
        resolve({ status: res.statusCode, body: chunk == null ? '' : String(chunk) });
      },
    };
    let index = 0;
    const next = (): void => {
      const handler = middlewares[index];
      index += 1;
      if (!handler) {
        resolve({ status: 404, body: '' });
        return;
      }
      try {
        handler(req, res, next);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    next();
  });
}

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'aidev-vite-'));
  const home = await mkdtemp(path.join(tmpdir(), 'aidev-home-'));
  temps.push(root, home);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo-app' }), 'utf8');
  await writeFile(path.join(home, 'token'), 'machine-token\n', { mode: 0o600 });
  process.env.AIDEV_HOME = home;
  return root;
}
