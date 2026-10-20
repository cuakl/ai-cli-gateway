import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createPromptRunner, DEFAULT_GATEWAY_URL, type PromptRunner } from './bridge.js';
import { injectDataLoc } from './jsx-transform.js';
import { overlayPublicPath, resolveOverlayBundle } from './overlay-path.js';
import { placeBeforeJsxCompilers } from './plugin-order.js';
import { registerDevtoolsSocket } from './socket.js';

export { createPromptRunner, DEFAULT_GATEWAY_URL } from './bridge.js';
export type { DevtoolsPromptInput, PromptRunner, PromptSession } from './bridge.js';
export { injectDataLoc } from './jsx-transform.js';
export type { DataLocResult } from './jsx-transform.js';
export { CANCEL_EVENT, PROMPT_EVENT, STREAM_EVENT } from './socket.js';

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
 * `ai-devtools:prompt` / `ai-devtools:cancel` on Vite's HMR socket.
 */
export function aiDevtools(options: DevtoolsPluginOptions = {}): Plugin {
  let command: 'build' | 'serve' = 'serve';
  let root = process.cwd();
  let publicPath = overlayPublicPath('/');
  let overlayFile = '';
  const runner: PromptRunner = createPromptRunner({
    gatewayUrl: resolveGatewayUrl(options.gatewayUrl),
    onFallback(gatewayUrl, provider) {
      console.warn(
        `[ai-devtools] Gateway at ${gatewayUrl} is unreachable. Running ${provider} through @gateway/core.`,
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
    configResolved(config) {
      command = config.command;
      root = config.root;
      publicPath = overlayPublicPath(config.base);
      overlayFile = resolveOverlayBundle();
      if (devActive()) placeBeforeJsxCompilers(config.plugins as Plugin[]);
    },
    transform(code, id) {
      if (!devActive() || options.injectDataLoc === false) return null;
      return injectDataLoc(code, id, root);
    },
    transformIndexHtml(html) {
      if (!devActive()) return undefined;
      if (html.includes(publicPath)) return undefined;
      return [
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
      registerDevtoolsSocket(server, runner, server.config.root);
    },
  };
}

export default aiDevtools;

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
      `AI DevTools overlay bundle was not found at ${file}. Build @devtools/overlay and restart the dev server.`,
    );
  }
}
