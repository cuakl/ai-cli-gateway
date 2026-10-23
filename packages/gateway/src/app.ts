import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { logger } from '@aidev/adapters';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthGuard } from './auth/guard.js';
import { AuthService } from './auth/principal.js';
import { resolveConfig } from './config.js';
import { HttpError, sendHttpError } from './errors.js';
import { ensureHome, resolveAidevHome } from './home.js';
import { ProjectRegistry } from './projects/registry.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerPromptRoutes } from './routes/prompt.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerStatusRoutes } from './routes/status.js';
import { createDefaultRuntime, type GatewayRuntime } from './runtime.js';
import { SessionRegistry } from './sessions/registry.js';
import type { ServerDeps } from './types.js';
import { registerWebSocketRoutes } from './ws/handler.js';
import { registerWorkspaceRoutes } from './ws/workspace.js';

export { CLI_NAME, HOME_DIRNAME, PRODUCT_NAME, SCOPE } from './brand.js';

export interface BuildServerOptions {
  runtime?: GatewayRuntime;
  registry?: SessionRegistry;
  /**
   * Directory auto-registered as a project root.
   * `startServer` sets this from `GATEWAY_ROOT`.
   */
  root?: string;
  /** Fastify request logs. Defaults to off; the process entry logs the bind address. */
  logger?: boolean;
  /**
   * Config directory. Tests must pass a temporary directory.
   * Defaults to `AIDEV_HOME` or `~/.aidev`.
   */
  home?: string;
  /** Bind address recorded for the loopback PTY check. */
  host?: string;
}

/**
 * Build the gateway without binding a port. Tests inject a runtime and call
 * `listen({ port: 0 })` themselves.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  if (!options.home && process.env.VITEST) {
    throw new Error('buildServer requires options.home in tests so it does not touch the real home directory');
  }
  const home = options.home ?? resolveAidevHome();
  const ensured = await ensureHome(home);
  const projects = new ProjectRegistry(home);
  await projects.load();
  if (options.root) await projects.register({ root: options.root });
  const deps: ServerDeps = {
    registry: options.registry ?? new SessionRegistry(),
    runtime: options.runtime ?? createDefaultRuntime(),
    home,
    projects,
    auth: new AuthService(ensured.token, projects),
    bindHost: options.host ?? '127.0.0.1',
    ...(options.root ? { root: options.root } : {}),
  };

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
    forceCloseConnections: true,
  });

  app.addHook('onClose', async () => {
    deps.registry.dispose();
  });
  app.addHook('onListen', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') return;
    deps.projects.trustOrigin(`http://127.0.0.1:${address.port}`);
    deps.projects.trustOrigin(`http://localhost:${address.port}`);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError && error.code === 'unauthorized') {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (error instanceof HttpError) return sendHttpError(reply, error);
    const coded = error as { statusCode?: number; code?: string; message?: string };
    if (coded.statusCode === 400 && coded.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    if (typeof coded.statusCode === 'number' && coded.statusCode >= 400 && coded.statusCode < 500) {
      return reply.code(coded.statusCode).send({
        error: 'bad_request',
        message: coded.message ?? 'Bad request',
      });
    }
    logger.error(error instanceof Error ? error.message : 'request failed');
    return reply.code(500).send({
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, deps.projects.allowsOrigin(origin) ? origin : false);
    },
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'accept'],
  });
  await app.register(websocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
  });

  registerAuthGuard(app, deps);
  registerDashboardRoutes(app);
  registerHealthRoutes(app, deps);
  registerStatusRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerPromptRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerWebSocketRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);

  return app;
}

/** Bind the default runtime to `HOST`/`PORT` (loopback:4100 unless overridden). */
export async function startServer(): Promise<FastifyInstance> {
  const config = resolveConfig();
  const app = await buildServer({
    home: config.home,
    host: config.host,
    ...(config.root ? { root: config.root } : {}),
  });
  await app.listen({ host: config.host, port: config.port });
  const bound = app.server.address();
  const port = bound && typeof bound === 'object' ? bound.port : config.port;
  logger.info(`listening on http://${config.host}:${port}`);
  return app;
}
