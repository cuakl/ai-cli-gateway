import type { FastifyReply } from 'fastify';

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
  return reply.code(error.statusCode).send({
    error: error.code,
    message: error.message,
    ...(error.details !== undefined ? { issues: error.details } : {}),
  });
}
