import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { logger } from '@aidev/adapters';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolveConfig } from './config.js';
import { HttpError, sendHttpError } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPromptRoutes } from './routes/prompt.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { createDefaultRuntime, type GatewayRuntime } from './runtime.js';
import { SessionRegistry } from './sessions/registry.js';
import type { ServerDeps } from './types.js';
import { registerWebSocketRoutes } from './ws/handler.js';

export { CLI_NAME, HOME_DIRNAME, PRODUCT_NAME, SCOPE } from './brand.js';

export interface BuildServerOptions {
  runtime?: GatewayRuntime;
  registry?: SessionRegistry;
  /** Directory that prompt paths must stay inside. `startServer` sets this from config. */
  root?: string;
  /** Fastify request logs. Defaults to off; the process entry logs the bind address. */
  logger?: boolean;
}

/**
 * Build the gateway without binding a port. Tests inject a runtime and call
 * `listen({ port: 0 })` themselves.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
    forceCloseConnections: true,
  });
  const deps: ServerDeps = {
    registry: options.registry ?? new SessionRegistry(),
    runtime: options.runtime ?? createDefaultRuntime(),
    ...(options.root !== undefined ? { root: options.root } : {}),
  };

  app.addHook('onClose', async () => {
    deps.registry.dispose();
  });

  app.setErrorHandler((error, _request, reply) => {
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

  await app.register(cors, { origin: true });
  await app.register(websocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
  });

  registerHealthRoutes(app, deps);
  registerPromptRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerWebSocketRoutes(app, deps);

  return app;
}

/** Bind the default runtime to `HOST`/`PORT` (loopback:4100 unless overridden). */
export async function startServer(): Promise<FastifyInstance> {
  const config = resolveConfig();
  const app = await buildServer({ root: config.root });
  await app.listen({ host: config.host, port: config.port });
  const bound = app.server.address();
  const port = bound && typeof bound === 'object' ? bound.port : config.port;
  logger.info(`listening on http://${config.host}:${port}`);
  return app;
}
