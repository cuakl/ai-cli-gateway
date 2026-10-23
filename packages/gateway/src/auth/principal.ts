import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../errors.js';
import { tokensEqual, type ProjectRegistry } from '../projects/registry.js';

export type Principal =
  | { kind: 'machine' }
  | { kind: 'inference' }
  | { kind: 'browser'; projectId: string; allowRemoteShell: boolean };

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export class AuthService {
  constructor(
    private readonly machineToken: string,
    private readonly projects: ProjectRegistry,
    private readonly inferenceTokens: readonly string[] = [],
  ) {}

  authenticate(token: string | undefined): Principal | null {
    if (!token) return null;
    if (tokensEqual(token, this.machineToken)) return { kind: 'machine' };
    for (const item of this.inferenceTokens) {
      if (tokensEqual(token, item)) return { kind: 'inference' };
    }
    const grant = this.projects.browserGrant(token);
    if (!grant) return null;
    return { kind: 'browser', projectId: grant.projectId, allowRemoteShell: grant.allowRemoteShell };
  }
}

export function readRequestToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (match?.[1]) return match[1];
  }
  return tokenFromUrl(request.url);
}

export function tokenFromUrl(url: string): string | undefined {
  const query = url.indexOf('?');
  if (query === -1) return undefined;
  const token = new URLSearchParams(url.slice(query + 1)).get('token');
  return token?.trim() ? token : undefined;
}

export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) {
    throw new HttpError(401, 'unauthorized', 'A bearer token is required');
  }
  return request.principal;
}

export function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: 'unauthorized' });
}

export function sendForbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: 'forbidden' });
}

export function pathnameOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;
  const bare = host.replace(/^\[|\]$/g, '').trim().toLowerCase();
  return LOOPBACK.has(bare);
}

/**
 * A PTY is allowed for a machine token, or for a browser token of this project
 * when the gateway is bound to loopback. `allowRemoteShell` is required only
 * when the bind address is not loopback.
 */
export function ptyPermitted(principal: Principal, bindHost: string): boolean {
  if (principal.kind === 'machine') return true;
  if (principal.kind !== 'browser') return false;
  if (isLoopbackHost(bindHost)) return true;
  return principal.allowRemoteShell;
}
