import type { FastifyReply } from 'fastify';
import { RETRY_AFTER_SECONDS } from './threads/scheduler.js';

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

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => typeof item === 'string')) return undefined;
  return value;
}
