import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../types.js';
import {
  pathnameOf,
  readRequestToken,
  sendForbidden,
  sendUnauthorized,
} from './principal.js';

const PROJECT_WS = /^\/api\/v1\/projects\/([^/]+)\/ws$/;

/**
 * Bearer auth for `/api/v1/*`, `/v1/*`, and WebSocket routes.
 * A WebSocket upgrade whose Origin is not a registered project origin is rejected.
 * HTTP requests with a disallowed Origin still run when the token is valid; CORS omits ACAO.
 */
export function registerAuthGuard(app: FastifyInstance, deps: ServerDeps): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const pathname = pathnameOf(request.url);
    const websocket = isWebsocket(pathname, request.headers.upgrade);
    if (websocket) {
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
      if (origin && !deps.projects.allowsOrigin(origin)) {
        return sendForbidden(reply);
      }
    }
    if (!requiresAuth(pathname)) return;
    const principal = deps.auth.authenticate(readRequestToken(request));
    if (!principal) return sendUnauthorized(reply);
    if (isInferenceRoute(pathname)) {
      if (principal.kind === 'browser') return sendForbidden(reply);
    } else if (principal.kind === 'inference') {
      return sendForbidden(reply);
    }
    const projectWs = PROJECT_WS.exec(pathname);
    if (projectWs?.[1]) {
      const projectId = decodeURIComponent(projectWs[1]);
      const project = deps.projects.get(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found', message: `Project ${projectId} was not found` });
      }
      if (principal.kind === 'browser' && principal.projectId !== projectId) {
        return sendForbidden(reply);
      }
    }
    request.principal = principal;
  });
}

function requiresAuth(pathname: string): boolean {
  return pathname === '/ws' || pathname.startsWith('/api/v1/') || pathname.startsWith('/v1/');
}

/** Machine token or `config.inferenceTokens`. Browser tokens are 403. */
function isInferenceRoute(pathname: string): boolean {
  return pathname === '/api/v1/infer' || pathname.startsWith('/v1/');
}

function isWebsocket(pathname: string, upgrade: string | undefined): boolean {
  if (pathname === '/ws' || PROJECT_WS.test(pathname)) return true;
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket';
}
