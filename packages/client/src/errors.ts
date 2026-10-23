export class AidevClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'AidevClientError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function isAidevClientError(error: unknown): error is AidevClientError {
  return error instanceof AidevClientError;
}
