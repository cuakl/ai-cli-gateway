import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { subscribeProjectActivity } from './activity-socket.js';
import { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE } from './brand.js';
import { DEFAULT_GATEWAY_URL, ensureGateway } from './companion.js';
import { DEFAULT_RELOAD_DEBOUNCE_MS, createHmrGuard } from './hmr-guard.js';
import { injectDataLoc } from './jsx-transform.js';
import { overlayPublicPath, resolveOverlayBundle } from './overlay-path.js';
import { placeBeforeJsxCompilers } from './plugin-order.js';
import { readMachineToken, registerProject, type RegisteredProject } from './register-project.js';

export { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE };
export { DEFAULT_GATEWAY_URL } from './companion.js';
export { DEFAULT_RELOAD_DEBOUNCE_MS, createHmrGuard } from './hmr-guard.js';
export { injectDataLoc } from './jsx-transform.js';
export type { DataLocResult } from './jsx-transform.js';

/** Dev-server route the overlay hits after the gateway forgets a browser token. */
export const CONFIG_PATH = '/@ai-devtools/config';

export interface DevtoolsPluginOptions {
  /** Gateway origin. Defaults to `GATEWAY_URL` or `http://127.0.0.1:4100`. */
  gatewayUrl?: string;
  /**
   * Turn the plugin on. Defaults to true while Vite is serving and false for builds,
   * so production bundles do not reference the dev overlay.
   */
  enabled?: boolean;
  /** Stamp `data-loc` onto JSX in dev. Defaults to true. */
  injectDataLoc?: boolean;
  /**
   * Spawn `aidev start --detach` when `/health` fails. Defaults to true.
   * When this is false, or the spawn fails, the plugin logs `npx aidev start`.
   */
  autoStart?: boolean;
}

export interface InjectedDevtoolsConfig {
  gatewayUrl: string;
  projectId?: string;
  browserToken?: string;
  projectName?: string;
}

/**
 * Inject the DevTools overlay, stamp JSX with source locations, register the
 * project with the gateway, and hold full reloads while a run is active.
 */
export function aiDevtools(options: DevtoolsPluginOptions = {}): Plugin {
  let command: 'build' | 'serve' = 'serve';
  let root = process.cwd();
  let publicPath = overlayPublicPath('/');
  let overlayFile = '';
  let projectName: string | undefined;
  const gatewayUrl = resolveGatewayUrl(options.gatewayUrl);
  const autoStart = options.autoStart !== false;
  let latest: RegisteredProject | null = null;
  let registerNow: () => Promise<RegisteredProject | null> = async () => latest;

  const devActive = (): boolean => {
    if (command !== 'serve') return false;
    return options.enabled ?? true;
  };

  const configFor = (registered: RegisteredProject | null): InjectedDevtoolsConfig => ({
    gatewayUrl,
    ...(projectName ? { projectName } : {}),
    ...(registered ? { projectId: registered.projectId, browserToken: registered.browserToken } : {}),
  });

  return {
    name: 'ai-devtools',
    enforce: 'pre',
    config() {
      return {
        server: {
          watch: {
            awaitWriteFinish: {
              stabilityThreshold: DEFAULT_RELOAD_DEBOUNCE_MS,
              pollInterval: 50,
            },
          },
        },
      };
    },
    configResolved(config) {
      command = config.command;
      root = config.root;
      publicPath = overlayPublicPath(config.base);
      overlayFile = resolveOverlayBundle();
      projectName = readProjectName(root);
      if (devActive()) placeBeforeJsxCompilers(config.plugins as Plugin[]);
    },
    transform(code, id) {
      if (!devActive() || options.injectDataLoc === false) return null;
      return injectDataLoc(code, id, root);
    },
    async transformIndexHtml(html) {
      if (!devActive()) return undefined;
      if (html.includes(publicPath)) return undefined;
      const registered = await registerNow();
      const configScript = `globalThis.${GLOBAL_CONFIG_KEY}=${JSON.stringify(configFor(registered)).replace(/</g, '\\u003c')};`;
      return [
        {
          tag: 'script',
          attrs: { 'data-ai-devtools': 'config' },
          children: configScript,
          injectTo: 'head',
        },
        {
          tag: 'script',
          attrs: { type: 'module', src: publicPath },
          injectTo: 'head',
        },
      ];
    },
    configureServer(server) {
      if (!devActive()) return;
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (pathname !== publicPath && pathname !== `${publicPath}.map`) {
          next();
          return;
        }
        void sendOverlay(res, pathname.endsWith('.map') ? `${overlayFile}.map` : overlayFile);
      });
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (pathname !== CONFIG_PATH) {
          next();
          return;
        }
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        void writeConfig(res, async () => configFor(await registerNow()));
      });

      if (server.config.server.middlewareMode || !server.httpServer) return;

      const guard = createHmrGuard(server.ws, DEFAULT_RELOAD_DEBOUNCE_MS);
      let held = false;
      let activity: { close(): void } | null = null;
      let activityStarted = false;
      let boot: Promise<boolean> | null = null;
      let announced = false;

      const ensure = (): Promise<boolean> => {
        if (boot) return boot;
        const pending = ensureGateway({
          gatewayUrl,
          autoStart,
          log: (line) => {
            if (announced) return;
            announced = true;
            console.warn(line);
          },
        }).finally(() => {
          if (boot === pending) boot = null;
        });
        boot = pending;
        return pending;
      };

      const remember = (registered: RegisteredProject, token: string): void => {
        latest = registered;
        if (activityStarted) return;
        activityStarted = true;
        activity = subscribeProjectActivity({
          gatewayUrl,
          projectId: registered.projectId,
          token,
          onActivity(activeRuns) {
            if (activeRuns > 0) {
              if (!held) {
                held = true;
                guard.begin();
              }
              return;
            }
            if (!held) return;
            held = false;
            guard.end();
          },
        });
      };

      registerNow = async () => {
        await whenListening(server);
        const up = await ensure();
        if (up) announced = false;
        if (!up) return null;
        const token = await readMachineToken();
        if (!token) return null;
        const origin = serverOrigin(server);
        if (!origin) return null;
        const registered = await registerProject({ gatewayUrl, root, origin, token });
        if (registered) remember(registered, token);
        return registered;
      };

      void registerNow();
      server.httpServer.on('close', () => {
        activity?.close();
        activity = null;
      });
    },
  };
}

export default aiDevtools;

async function writeConfig(res: ServerResponse, load: () => Promise<InjectedDevtoolsConfig>): Promise<void> {
  let config: InjectedDevtoolsConfig;
  try {
    config = await load();
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('{}');
    return;
  }
  res.statusCode = config.projectId && config.browserToken ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(config));
}

function readProjectName(root: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof raw.name !== 'string') return undefined;
    const name = raw.name.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function resolveGatewayUrl(explicit: string | undefined): string {
  const value = explicit ?? process.env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
  return value.replace(/\/$/, '');
}

function whenListening(server: ViteDevServer): Promise<void> {
  const httpServer = server.httpServer;
  if (!httpServer || httpServer.listening) return Promise.resolve();
  return new Promise((resolve) => {
    httpServer.once('listening', () => resolve());
  });
}

function serverOrigin(server: ViteDevServer): string | null {
  const address = server.httpServer?.address();
  const port = address && typeof address === 'object' ? address.port : server.config.server.port;
  if (!port) return null;
  const hostSetting = server.config.server.host;
  const host =
    hostSetting === true || hostSetting === '0.0.0.0' || hostSetting === '::' || !hostSetting
      ? '127.0.0.1'
      : hostSetting;
  const hostname = host.includes(':') ? `[${host}]` : host;
  const protocol = server.config.server.https ? 'https' : 'http';
  return `${protocol}://${hostname}:${port}`;
}

async function sendOverlay(res: ServerResponse, file: string): Promise<void> {
  try {
    const body = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', file.endsWith('.map') ? 'application/json' : 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(
      `AI DevTools overlay bundle was not found at ${file}. Build @aidev/overlay and restart the dev server.`,
    );
  }
}
