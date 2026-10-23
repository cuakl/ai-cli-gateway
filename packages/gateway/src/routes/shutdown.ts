import type { FastifyInstance } from 'fastify';
import { requirePrincipal, sendForbidden } from '../auth/principal.js';

/**
 * Machine-token-only process stop. Browser and inference tokens are 403.
 * Close is deferred so this response can flush.
 */
export function registerShutdownRoutes(app: FastifyInstance): void {
  app.post('/api/v1/shutdown', async (request, reply) => {
    if (requirePrincipal(request).kind !== 'machine') return sendForbidden(reply);
    setImmediate(() => {
      void app.close();
    });
    return { ok: true };
  });
}
