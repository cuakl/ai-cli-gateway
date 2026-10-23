import type { FastifyInstance } from 'fastify';
import { requirePrincipal } from '../auth/principal.js';
import { countActiveRuns, rootsFor } from '../execute.js';
import type { ServerDeps } from '../types.js';
import { GATEWAY_VERSION } from '../version.js';

export function registerStatusRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/v1/status', async (request) => {
    const principal = requirePrincipal(request);
    const providers = await deps.runtime.listCapabilities();
    const allowed = new Set(rootsFor(deps, principal));
    const projects =
      principal.kind === 'machine'
        ? deps.projects.list()
        : principal.kind === 'browser'
          ? deps.projects.list().filter((project) => allowed.has(project.root))
          : [];
    return {
      status: 'ok' as const,
      version: GATEWAY_VERSION,
      activeRuns: countActiveRuns(deps, principal),
      projects,
      providers,
    };
  });

  app.get('/api/v1/doctor', async (request) => {
    requirePrincipal(request);
    const providers = await deps.runtime.listCapabilities();
    return { version: GATEWAY_VERSION, providers };
  });
}
