import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveOverlayBundle } from '../overlay-path.js';

/**
 * Public static overlay IIFE. No auth — this is the built browser bundle,
 * not a project secret. 404 explains how to build it when the file is missing.
 */
export function registerOverlayRoutes(app: FastifyInstance, overlayFile = resolveOverlayBundle()): void {
  app.get('/overlay.js', async (_request, reply) => sendOverlay(reply, overlayFile));
  app.get('/overlay.js.map', async (_request, reply) => sendOverlay(reply, `${overlayFile}.map`));
}

async function sendOverlay(reply: FastifyReply, file: string): Promise<void> {
  try {
    const body = await readFile(file);
    await reply
      .type(file.endsWith('.map') ? 'application/json' : 'application/javascript')
      .header('cache-control', 'no-cache')
      .send(body);
  } catch {
    await reply
      .code(404)
      .type('text/plain; charset=utf-8')
      .send(
        `AI DevTools overlay bundle was not found at ${file}. Build @aidev/overlay (pnpm --filter @aidev/overlay build) and restart the gateway.`,
      );
  }
}
