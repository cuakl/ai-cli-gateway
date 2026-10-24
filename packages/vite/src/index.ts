import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { HtmlTagDescriptor, Plugin, ViteDevServer } from 'vite';
import { subscribeProjectActivity } from './activity-socket.js';
import { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE } from './brand.js';
import { DEFAULT_GATEWAY_URL, ensureGateway } from './companion.js';
import { EARLY_ERROR_SCRIPT } from './early-errors.js';
import { DEFAULT_RELOAD_DEBOUNCE_MS, createHmrGuard } from './hmr-guard.js';
import { injectDataLoc } from './jsx-transform.js';
import { overlayGatewaySrc, overlayPublicPath, resolveOverlayBundle } from './overlay-path.js';
import { placeBeforeJsxCompilers } from './plugin-order.js';
import { readMachineToken, registerProject, type RegisteredProject } from './register-project.js';
import { createVueDataLocTransform, type VueNodeTransform } from './vue-transform.js';

export { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE };
export { DEFAULT_GATEWAY_URL, ensureGateway, gatewayStartHint, resolveGatewayBin } from './companion.js';
export type { EnsureGatewayOptions } from './companion.js';
export { DEFAULT_RELOAD_DEBOUNCE_MS, createHmrGuard } from './hmr-guard.js';
export { EARLY_ERROR_SCRIPT } from './early-errors.js';
export { overlayGatewaySrc, overlayPublicPath, resolveOverlayBundle } from './overlay-path.js';
export { injectDataLoc } from './jsx-transform.js';
export type { DataLocResult } from './jsx-transform.js';
export { readMachineToken, registerProject } from './register-project.js';
export type { RegisteredProject } from './register-project.js';
export { aidevSveltePreprocess } from './svelte-preprocess.js';
export type { AidevMarkupPreprocessor, AidevSveltePreprocessOptions } from './svelte-preprocess.js';
export { createVueDataLocTransform } from './vue-transform.js';
export type { VueNodeTransform } from './vue-transform.js';

/** Dev-server route the overlay hits after a project-socket auth failure. */
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
  /**
   * `'vue'` returns a template `nodeTransform` instead of a Vite plugin.
   * Pass it to `@vitejs/plugin-vue` `template.compilerOptions.nodeTransforms`.
   * There is no plugin-level hook into Vue's compiler; keep `aiDevtools()` as well
   * for overlay injection. Svelte uses `aidevSveltePreprocess()`.
   */
  framework?: 'react' | 'vue';
  /** Project root for Vue `data-loc` paths. Defaults to `process.cwd()`. */
  root?: string;
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
 *
 * `aiDevtools({ framework: 'vue' })` returns a Vue `nodeTransform` — there is
 * no hook that lets this plugin inject into `@vitejs/plugin-vue` on its own.
 */
export function aiDevtools(options: DevtoolsPluginOptions & { framework: 'vue' }): VueNodeTransform;
export function aiDevtools(options?: DevtoolsPluginOptions): Plugin;
export function aiDevtools(options: DevtoolsPluginOptions = {}): Plugin | VueNodeTransform {
  if (options.framework === 'vue') {
    return createVueDataLocTransform({
      ...(options.root !== undefined ? { root: options.root } : {}),
      ...(options.injectDataLoc !== undefined ? { injectDataLoc: options.injectDataLoc } : {}),
    });
  }
  return createDevtoolsPlugin(options);
}

function createDevtoolsPlugin(options: DevtoolsPluginOptions): Plugin {
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
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        if (!devActive()) return undefined;
        const tags: HtmlTagDescriptor[] = [
          {
            tag: 'script',
            attrs: { 'data-ai-devtools': 'early' },
            children: EARLY_ERROR_SCRIPT,
            injectTo: 'head-prepend',
          },
        ];
        const overlaySrc = overlayGatewaySrc(gatewayUrl);
        if (html.includes(overlaySrc) || html.includes(publicPath)) return tags;
        const registered = await registerNow();
        const configScript = `globalThis.${GLOBAL_CONFIG_KEY}=${JSON.stringify(configFor(registered)).replace(/</g, '\\u003c')};`;
        tags.push(
          {
            tag: 'script',
            attrs: { 'data-ai-devtools': 'config' },
            children: configScript,
            injectTo: 'head',
          },
          {
            tag: 'script',
            attrs: { src: overlaySrc, defer: true, 'data-ai-devtools': 'overlay' },
            injectTo: 'head',
          },
        );
        return tags;
      },
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
