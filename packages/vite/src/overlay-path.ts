import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Public URL path of the injected overlay module, before Vite's `base`. */
export const OVERLAY_BASENAME = '@ai-devtools/overlay.js';

export function overlayPublicPath(base: string): string {
  const prefix = base === '' || base === '/' ? '/' : base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${OVERLAY_BASENAME}`;
}

/** Classic-script URL of the overlay loader on the gateway. */
export function overlayGatewaySrc(gatewayUrl: string): string {
  return `${gatewayUrl.replace(/\/$/, '')}/overlay.js`;
}

/**
 * Absolute path of the built overlay loader.
 * Resolved through the `@aidev/overlay/overlay.js` package export.
 */
export function resolveOverlayBundle(): string {
  try {
    return require.resolve('@aidev/overlay/overlay.js');
  } catch {
    return fileURLToPath(new URL('../../overlay/dist/overlay.js', import.meta.url));
  }
}
