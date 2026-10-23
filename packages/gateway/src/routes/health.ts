import type { FastifyInstance } from 'fastify';
import { readRequestToken } from '../auth/principal.js';
import type { ServerDeps } from '../types.js';
import { GATEWAY_VERSION } from '../version.js';

export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async (request) => {
    const body: {
      status: 'ok';
      version: string;
      availableProviders?: Awaited<ReturnType<ServerDeps['runtime']['listProviders']>>;
    } = {
      status: 'ok',
      version: GATEWAY_VERSION,
    };
    const principal = deps.auth.authenticate(readRequestToken(request));
    if (!principal) return body;
    body.availableProviders = await deps.runtime.listProviders();
    return body;
  });

  app.get('/api/v1/providers', async () => {
    const providers = await deps.runtime.listProviders();
    return { providers };
  });
}
