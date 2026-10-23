import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveDashboardDist } from '../dashboard-path.js';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Public static dashboard SPA. No auth — this is the built browser bundle,
 * not a project secret. 404 explains how to build it when dist is missing.
 */
export function registerDashboardRoutes(app: FastifyInstance, distDir = resolveDashboardDist()): void {
  app.get('/', async (_request, reply) => reply.redirect('/dashboard/', 302));
  app.get('/dashboard', async (_request, reply) => sendIndex(reply, distDir));
  app.get('/dashboard/', async (_request, reply) => sendIndex(reply, distDir));
  app.get('/dashboard/*', async (request, reply) => {
    const rest = String((request.params as { '*': string })['*'] ?? '');
    const file = confined(distDir, rest);
    if (file) {
      try {
        const info = await stat(file);
        if (info.isFile()) {
          await sendFile(reply, file);
          return;
        }
      } catch {
        // Missing file: SPA fallback for extension-less routes.
      }
    }
    if (!path.extname(rest)) {
      await sendIndex(reply, distDir);
      return;
    }
    await reply.code(404).type('text/plain; charset=utf-8').send('Not found');
  });
}

async function sendIndex(reply: FastifyReply, distDir: string): Promise<void> {
  try {
    const html = await readFile(path.join(distDir, 'index.html'));
    await reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
  } catch {
    await missing(reply, distDir);
  }
}

async function sendFile(reply: FastifyReply, file: string): Promise<void> {
  const body = await readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  await reply.type(type).header('cache-control', 'no-cache').send(body);
}

async function missing(reply: FastifyReply, distDir: string): Promise<void> {
  await reply
    .code(404)
    .type('text/plain; charset=utf-8')
    .send(
      `AI DevTools dashboard was not found at ${distDir}. Build @aidev/dashboard (pnpm --filter @aidev/dashboard build) and restart the gateway.`,
    );
}

function confined(root: string, relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}
