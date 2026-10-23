import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, createServer, type ResolvedConfig, type ViteDevServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import aiDevtools, { aiDevtools as namedPlugin } from '../src/index.js';
import { resolveOverlayBundle } from '../src/overlay-path.js';

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
      gatewayUrl?: string;
      projectName?: string;
      projectId?: string;
      browserToken?: string;
      wsToken?: string;
      cwd?: string;
    };
    expect(config.gatewayUrl).toBe('http://127.0.0.1:4100');
    expect(config.projectName).toBe('@aidev/vite');
    expect(config.projectId).toBeUndefined();
    expect(config.browserToken).toBeUndefined();
    expect(config.wsToken).toBeUndefined();
    expect(config.cwd).toBeUndefined();

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
