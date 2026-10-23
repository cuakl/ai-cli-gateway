import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createPromptRunner, DEFAULT_GATEWAY_URL, type PromptRunner } from './bridge.js';
import { injectDataLoc } from './jsx-transform.js';
import { overlayPublicPath, resolveOverlayBundle } from './overlay-path.js';
import { placeBeforeJsxCompilers } from './plugin-order.js';
import { DEFAULT_RELOAD_DEBOUNCE_MS } from './hmr-guard.js';
import { registerDevtoolsSocket } from './socket.js';
import { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE } from './brand.js';
import { readMachineToken, registerProject, type RegisteredProject } from './register-project.js';

export { CLI_NAME, EVENT_PREFIX, GLOBAL_CONFIG_KEY, HOME_DIRNAME, PRODUCT_NAME, SCOPE };
export { createPromptRunner, DEFAULT_GATEWAY_URL } from './bridge.js';
export type { DevtoolsPromptInput, PromptRunner, PromptSession } from './bridge.js';
export { DEFAULT_RELOAD_DEBOUNCE_MS, createHmrGuard } from './hmr-guard.js';
export { injectDataLoc } from './jsx-transform.js';
export type { DataLocResult } from './jsx-transform.js';
export {
  CANCEL_EVENT,
  GIT_COMMIT_EVENT,
  GIT_DIFF_EVENT,
  GIT_REVERT_EVENT,
  PROMPT_EVENT,
  PTY_DATA_EVENT,
  PTY_DISPOSE_EVENT,
  PTY_EXIT_EVENT,
  PTY_INPUT_EVENT,
  PTY_RESIZE_EVENT,
  PTY_SPAWN_EVENT,
  RUN_TESTS_EVENT,
  STOP_TESTS_EVENT,
  STREAM_EVENT,
  TEST_DONE_EVENT,
  TEST_OUTPUT_EVENT,
} from './socket.js';

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
}

/**
 * Inject the DevTools overlay, stamp JSX with source locations, and bridge
 * `ai-devtools:prompt` / `ai-devtools:cancel` on Vite's HMR socket, plus git, PTY, and test events.
 */
export function aiDevtools(options: DevtoolsPluginOptions = {}): Plugin {
  let command: 'build' | 'serve' = 'serve';
  let root = process.cwd();
  let publicPath = overlayPublicPath('/');
  let overlayFile = '';
  let wsToken = '';
  let wsBase = '/';
  let projectName: string | undefined;
  const gatewayUrl = resolveGatewayUrl(options.gatewayUrl);
  let registration: Promise<RegisteredProject | null> | null = null;
  const runner: PromptRunner = createPromptRunner({
    gatewayUrl,
    onFallback(fallbackUrl, provider) {
      console.warn(
        `[ai-devtools] Gateway at ${fallbackUrl} is unreachable. Running ${provider} through @aidev/adapters.`,
      );
    },
  });

  const devActive = (): boolean => {
    if (command !== 'serve') return false;
    return options.enabled ?? true;
  };

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
      wsToken = config.webSocketToken;
      wsBase = config.base || '/';
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
      const registered = registration ? await registration : null;
      const configScript = `globalThis.${GLOBAL_CONFIG_KEY}=${JSON.stringify({
        wsToken,
        wsBase,
        gatewayUrl,
        cwd: root,
        ...(projectName ? { projectName } : {}),
        ...(registered
          ? { projectId: registered.projectId, browserToken: registered.browserToken }
          : {}),
      }).replace(/</g, '\\u003c')};`;
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
      const httpServer = server.httpServer;
      if (!server.config.server.middlewareMode && httpServer) {
        registration = new Promise((resolve) => {
          const finish = (): void => {
            const address = httpServer.address();
            const port = address && typeof address === 'object' ? address.port : server.config.server.port;
            const hostSetting = server.config.server.host;
            const host =
              hostSetting === true || hostSetting === '0.0.0.0' || hostSetting === '::' || !hostSetting
                ? '127.0.0.1'
                : hostSetting;
            if (!port) {
              resolve(null);
              return;
            }
            const origin = `http://${host}:${port}`;
            void readMachineToken()
              .then((token) => (token ? registerProject({ gatewayUrl, root, origin, token }) : null))
              .then((result) => resolve(result))
              .catch(() => resolve(null));
          };
          if (httpServer.listening) finish();
          else httpServer.once('listening', finish);
        });
      }
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (pathname !== publicPath && pathname !== `${publicPath}.map`) {
          next();
          return;
        }
        void sendOverlay(res, pathname.endsWith('.map') ? `${overlayFile}.map` : overlayFile);
      });
      registerDevtoolsSocket(server, runner, server.config.root);
    },
  };
}

export default aiDevtools;

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
