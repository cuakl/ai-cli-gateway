import { InferRequestSchema, type InferRequest } from '@aidev/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requirePrincipal, sendForbidden, type Principal } from '../auth/principal.js';
import { HttpError, sendHttpError } from '../errors.js';
import {
  beginInfer,
  cleanupInfer,
  completeInfer,
  inferSseSink,
  streamInfer,
  writeBufferedInferSse,
} from '../inference/run.js';
import type { ServerDeps } from '../types.js';

export { collectAssistantText } from '../inference/run.js';

export function registerInferRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/v1/infer', async (request, reply) => {
    try {
      const body = readInferRequest(request.body);
      const principal = requirePrincipal(request);
      if (principal.kind === 'browser') return sendForbidden(reply);
      return await handleInfer(deps, body, principal, reply);
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(reply, error);
      throw error;
    }
  });
}

export function readInferRequest(body: unknown): InferRequest {
  const parsed = InferRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid infer request';
    throw new HttpError(400, 'validation_error', message, parsed.error.issues);
  }
  return parsed.data;
}

async function handleInfer(
  deps: ServerDeps,
  body: InferRequest,
  principal: Principal,
  reply: FastifyReply,
): Promise<unknown> {
  const setup = await beginInfer(deps, body, 'api');
  try {
    if (body.stream === true && body.jsonSchema === undefined) {
      await streamInfer(deps, principal, setup, inferSseSink(reply));
      return;
    }
    const result = await completeInfer(deps, principal, setup);
    if (result.kind === 'structured_error') {
      return reply.code(422).send({
        error: 'invalid_structured_output',
        raw: result.raw,
        issues: result.issues,
      });
    }
    if (body.stream === true) {
      writeBufferedInferSse(reply, result.response);
      return;
    }
    return result.response;
  } finally {
    await cleanupInfer(setup);
  }
}
