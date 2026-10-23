import type { FastifyReply } from 'fastify';
import { RETRY_AFTER_SECONDS } from './threads/scheduler.js';

/** OpenAI-compatible façade lives under `/v1/`, not `/api/v1/`. */
export function isOpenAiPath(url: string): boolean {
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  return path.startsWith('/v1/');
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function sendHttpError(reply: FastifyReply, error: HttpError) {
  if (error.statusCode === 429) reply.header('Retry-After', String(RETRY_AFTER_SECONDS));
  const setup = stringList(error.details);
  return reply.code(error.statusCode).send({
    error: error.code,
    message: error.message,
    ...(setup ? { setup } : {}),
    ...(error.details !== undefined && !setup ? { issues: error.details } : {}),
  });
}

export function sendOpenAiError(reply: FastifyReply, error: HttpError) {
  if (error.statusCode === 429) reply.header('Retry-After', String(RETRY_AFTER_SECONDS));
  const type =
    error.statusCode === 429
      ? 'rate_limit_error'
      : error.statusCode >= 500
        ? 'api_error'
        : 'invalid_request_error';
  return reply.code(error.statusCode).send({
    error: {
      message: error.message || error.code,
      type,
      ...(error.code ? { code: error.code } : {}),
    },
  });
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => typeof item === 'string')) return undefined;
  return value;
}
