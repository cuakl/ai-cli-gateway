import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../types.js';

export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async () => {
    const availableProviders = await deps.runtime.listProviders();
    return {
      status: 'ok' as const,
      timestamp: Date.now(),
      availableProviders,
    };
  });

  app.get('/api/v1/providers', async () => {
    const providers = await deps.runtime.listProviders();
    return { providers };
  });
}
