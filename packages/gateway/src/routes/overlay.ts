import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveOverlayBundle } from '../overlay-path.js';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Public static overlay loader and ESM chunks. No auth — this is the built
 * browser bundle, not a project secret. 404 explains how to build it when
 * the loader is missing.
 */
export function registerOverlayRoutes(app: FastifyInstance, overlayFile = resolveOverlayBundle()): void {
  const distDir = path.dirname(overlayFile);
  app.get('/overlay.js', async (_request, reply) => sendOverlay(reply, overlayFile));
  app.get('/overlay.js.map', async (_request, reply) => sendOverlay(reply, `${overlayFile}.map`));
  app.get('/overlay/*', async (request, reply) => {
    const rest = String((request.params as { '*': string })['*'] ?? '');
    const file = confined(distDir, rest);
    if (!file) {
      await reply.code(404).type('text/plain; charset=utf-8').send('Not found');
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) {
        await reply.code(404).type('text/plain; charset=utf-8').send('Not found');
        return;
      }
      await sendChunk(reply, file);
    } catch {
      await reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    }
  });
}

async function sendOverlay(reply: FastifyReply, file: string): Promise<void> {
  try {
    const body = await readFile(file);
    await cors(reply)
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

async function sendChunk(reply: FastifyReply, file: string): Promise<void> {
  const body = await readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  await cors(reply).type(type).header('cache-control', 'no-cache').send(body);
}

function cors(reply: FastifyReply): FastifyReply {
  return reply.header('access-control-allow-origin', '*').header('cross-origin-resource-policy', 'cross-origin');
}

function confined(root: string, relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}
