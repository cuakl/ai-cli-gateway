import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Public URL path of the injected overlay module, before Vite's `base`. */
export const OVERLAY_BASENAME = '@ai-devtools/overlay.js';

export function overlayPublicPath(base: string): string {
  const prefix = base === '' || base === '/' ? '/' : base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${OVERLAY_BASENAME}`;
}

/**
 * Absolute path of the built overlay bundle.
 * The package export points at `dist/index.js`; `overlay.js` is the IIFE beside it.
 */
export function resolveOverlayBundle(): string {
  try {
    const entry = require.resolve('@devtools/overlay');
    return path.join(path.dirname(entry), 'overlay.js');
  } catch {
    return fileURLToPath(new URL('../../devtools-overlay/dist/overlay.js', import.meta.url));
  }
}
