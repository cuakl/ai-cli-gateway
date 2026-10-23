import { PromptRequestSchema, type PromptRequest } from '@aidev/protocol';
import type { FastifyInstance } from 'fastify';
import { executionHttpError, startExecution } from '../execute.js';
import { HttpError, sendHttpError } from '../errors.js';
import type { ServerDeps } from '../types.js';

export function registerPromptRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/v1/prompt', async (request, reply) => {
    try {
      const body = readPromptRequest(request.body);
      const { sessionId, done } = await startExecution(deps, body);
      const outcome = await done;
      if (outcome.error) {
        const httpError = executionHttpError(outcome.error);
        const setup = Array.isArray(httpError.details) ? httpError.details : undefined;
        return reply.code(httpError.statusCode).send({
          error: httpError.code,
          message: httpError.message,
          ...(setup?.every((item) => typeof item === 'string') ? { setup } : {}),
          sessionId,
          events: outcome.events,
        });
      }
      return {
        exitCode: outcome.exitCode,
        summary: outcome.summary,
        events: outcome.events,
      };
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(reply, error);
      throw error;
    }
  });
}

export function readPromptRequest(body: unknown): PromptRequest {
  const parsed = PromptRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue
      ? `${issue.path.join('.') || 'body'}: ${issue.message}`
      : 'Invalid prompt request';
    throw new HttpError(400, 'validation_error', message, parsed.error.issues);
  }
  return parsed.data;
}
