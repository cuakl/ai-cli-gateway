import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, createServer, type ResolvedConfig, type ViteDevServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { createStreamEvent } from '@aidev/protocol';
import aiDevtools, { aiDevtools as namedPlugin, STREAM_EVENT } from '../src/index.js';
import { resolveOverlayBundle } from '../src/overlay-path.js';
import { registerDevtoolsSocket } from '../src/socket.js';
import type { PromptRunner } from '../src/bridge.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

describe('aiDevtools', () => {
  let server: ViteDevServer | undefined;
  let endpoint: { url: string; close: () => Promise<void> } | undefined;

  afterAll(async () => {
    await endpoint?.close();
    await server?.close();
  });

  it('exports the named plugin as the default', () => {
    expect(namedPlugin).toBe(aiDevtools);
  });

  it('injects the overlay script and serves the bundle', async () => {
    server = await createServer({
      configFile: false,
      root: packageRoot,
      logLevel: 'error',
      appType: 'custom',
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [react(), aiDevtools()],
    });

    const html = await server.transformIndexHtml(
      '/index.html',
      '<!doctype html><html><head><title>Demo</title></head><body><div id="root"></div></body></html>',
    );
    expect(html).toMatch(
      /<head>[\s\S]*<script type="module" src="\/@ai-devtools\/overlay\.js"><\/script>[\s\S]*<\/head>/,
    );
    expect(html).toContain('__AI_DEVTOOLS__');
    const injected = html.match(/__AI_DEVTOOLS__=(\{.*?\});/);
    expect(injected?.[1]).toBeTruthy();
    const config = JSON.parse(injected?.[1] ?? '{}') as {
      wsToken?: string;
      gatewayUrl?: string;
      cwd?: string;
      projectName?: string;
    };
    expect(config.wsToken).toEqual(expect.any(String));
    expect(config.gatewayUrl).toBe('http://127.0.0.1:4100');
    expect(config.cwd).toBe(server.config.root);
    expect(config.projectName).toBe('@aidev/vite');

    const transformed = await server.transformRequest('/test/fixtures/element.tsx');
    expect(transformed?.code).toContain('test/fixtures/element.tsx:3:4');

    endpoint = await listen(server.middlewares);
    const response = await fetch(`${endpoint.url}/@ai-devtools/overlay.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const body = await response.text();
    expect(body).toBe(await readFile(resolveOverlayBundle(), 'utf8'));
    expect(body).toContain('ai-devtools');
  });

  it('stays out of production HTML', async () => {
    const root = await mkdtemp(path.join(packageRoot, '.tmp-build-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'index.html'),
      '<!doctype html><html><head><title>Demo</title></head><body><script type="module" src="/src/main.js"></script></body></html>',
    );
    await writeFile(path.join(root, 'src', 'main.js'), 'document.body.dataset.ready = "yes";\n');
    try {
      const output = await build({
        configFile: false,
        root,
        logLevel: 'error',
        plugins: [aiDevtools()],
        build: { write: false },
      });
      const bundle = Array.isArray(output) ? output[0] : output;
      if (!bundle || !('output' in bundle)) throw new Error('Expected a Rollup build result');
      const html = bundle.output.find((file) => file.fileName.endsWith('.html'));
      expect(html?.type).toBe('asset');
      if (html?.type === 'asset') expect(String(html.source)).not.toContain('@ai-devtools/overlay.js');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can be disabled in dev', async () => {
    const plugin = aiDevtools({ enabled: false });
    const resolved = plugin.configResolved;
    if (typeof resolved === 'function') {
      resolved.call({} as never, {
        command: 'serve',
        root: packageRoot,
        base: '/',
        plugins: [plugin],
      } as unknown as ResolvedConfig);
    }
    const transform = plugin.transform;
    const html = plugin.transformIndexHtml;
    const transformResult =
      typeof transform === 'function'
        ? await transform.call({} as never, '<button />\n', path.join(packageRoot, 'src/App.tsx'))
        : null;
    const htmlResult =
      typeof html === 'function'
        ? await html.call({} as never, '<html><head></head><body></body></html>', {} as never)
        : undefined;
    expect(transformResult).toBeNull();
    expect(htmlResult).toBeUndefined();
  });
});

describe('devtools socket', () => {
  it('streams gateway events and cancels the active session', async () => {
    const events: unknown[] = [];
    let cancelled = false;
    const runner: PromptRunner = {
      async start(_input, onEvent) {
        onEvent(createStreamEvent('sess_live', 'chunk', { text: 'hello' }));
        return {
          sessionId: 'sess_live',
          async cancel() {
            cancelled = true;
          },
        };
      },
    };
    const listeners = new Map<string, (data: unknown, client: StreamClient) => void>();
    const server = {
      config: {
        root: '/proj',
        logger: { error() {}, warn() {} },
      },
      ws: {
        on(event: string, listener: (data: unknown, client: StreamClient) => void) {
          listeners.set(event, listener);
        },
      },
    };
    registerDevtoolsSocket(server as unknown as ViteDevServer, runner, '/proj');
    const client: StreamClient = {
      send(event, data) {
        events.push({ event, data });
      },
    };
    await listeners.get('ai-devtools:prompt')?.(
      { provider: 'antigravity', prompt: 'Tighten the hero', files: ['src/App.tsx'] },
      client,
    );
    expect(events).toEqual([
      { event: STREAM_EVENT, data: { event: expect.objectContaining({ type: 'chunk', payload: { text: 'hello' } }) } },
    ]);
    await listeners.get('ai-devtools:cancel')?.({}, client);
    expect(cancelled).toBe(true);
  });

  it('rejects a prompt that has no provider', async () => {
    const events: Array<{ event: string; data: { event: { type: string; payload: { error?: string } } } }> = [];
    const runner: PromptRunner = {
      async start() {
        throw new Error('should not run');
      },
    };
    const listeners = new Map<string, (data: unknown, client: StreamClient) => void>();
    registerDevtoolsSocket(
      {
        config: { root: '/proj', logger: { error() {} } },
        ws: {
          on(event: string, listener: (data: unknown, client: StreamClient) => void) {
            listeners.set(event, listener);
          },
        },
      } as unknown as ViteDevServer,
      runner,
      '/proj',
    );
    await listeners.get('ai-devtools:prompt')?.(
      { prompt: 'hello' },
      {
        send(event, data) {
          events.push({ event, data: data as { event: { type: string; payload: { error?: string } } } });
        },
      },
    );
    expect(events.map((entry) => entry.data.event.type)).toEqual(['error', 'done']);
    expect(events[0]?.data.event.payload.error).toContain('provider');
  });
});

interface StreamClient {
  send(event: string, data?: unknown): void;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const httpServer = createHttpServer(handler);
  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('HTTP server did not bind a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            httpServer.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
