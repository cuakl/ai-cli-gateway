import type { InferRequest, InferResponse, ProviderType } from '@aidev/protocol';
import { AidevClientError } from './errors.js';
import { parseWithSchema, toJsonSchema } from './schema.js';
import { readNamedSse } from './sse.js';

const DEFAULT_URL = 'http://127.0.0.1:4100';
const HOME_DIRNAME = '.aidev';

export interface ClientOptions {
  /** Gateway origin. Defaults to `AIDEV_URL` or `http://127.0.0.1:4100`. */
  baseUrl?: string;
  /** Bearer token. Defaults to `AIDEV_TOKEN`, then `$AIDEV_HOME/token` (Node only, lazy). */
  token?: string;
  fetch?: typeof fetch;
}

export interface InferImageInput {
  dataUrl: string;
  path?: never;
}

export interface InferPathInput {
  path: string;
  dataUrl?: never;
}

export interface GenerateInput {
  prompt?: string;
  messages?: InferRequest['messages'];
  provider?: ProviderType;
  model?: string;
  system?: string;
  images?: Array<InferImageInput | InferPathInput>;
  timeoutMs?: number;
  keep?: boolean;
}

export interface GenerateObjectInput extends GenerateInput {
  schema: unknown;
}

export interface AidevClient {
  generate(input: GenerateInput): Promise<InferResponse>;
  stream(input: GenerateInput): AsyncIterable<string>;
  generateObject<T = unknown>(input: GenerateObjectInput): Promise<T>;
}

export function createClient(options: ClientOptions = {}): AidevClient {
  const baseUrl = trimSlash(options.baseUrl ?? env('AIDEV_URL') ?? DEFAULT_URL);
  const fetcher = options.fetch ?? fetch;
  let resolvedToken: string | undefined = options.token?.trim() || undefined;

  const token = async (): Promise<string> => {
    if (resolvedToken) return resolvedToken;
    const fromEnv = env('AIDEV_TOKEN');
    if (fromEnv) {
      resolvedToken = fromEnv;
      return fromEnv;
    }
    resolvedToken = await readTokenFile();
    return resolvedToken;
  };

  const post = async (body: InferRequest, stream = false): Promise<Response> => {
    const headers = new Headers({
      'content-type': 'application/json',
      authorization: `Bearer ${await token()}`,
      accept: stream ? 'text/event-stream' : 'application/json',
    });
    const response = await fetcher(`${baseUrl}/api/v1/infer`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return response;
  };

  return {
    async generate(input) {
      const response = await post(toBody(input));
      const payload = await readJson(response);
      if (!response.ok) throw fromErrorBody(response.status, payload);
      return payload as InferResponse;
    },

    async *stream(input) {
      const response = await post(toBody(input, true), true);
      if (!response.ok) {
        const payload = await readJson(response);
        throw fromErrorBody(response.status, payload);
      }
      for await (const frame of readNamedSse(response)) {
        if (frame.event === 'error') {
          throw fromErrorBody(500, frame.data);
        }
        if (frame.event !== 'delta' || !isRecord(frame.data)) continue;
        if (typeof frame.data.text === 'string') yield frame.data.text;
      }
    },

    async generateObject(input) {
      const jsonSchema = await toJsonSchema(input.schema);
      const response = await post({ ...toBody(input), jsonSchema });
      const payload = await readJson(response);
      if (!response.ok) throw fromErrorBody(response.status, payload);
      if (!isRecord(payload) || !('object' in payload)) {
        throw new AidevClientError('Gateway reply was missing object', 'invalid_structured_output', response.status);
      }
      return parseWithSchema(input.schema, payload.object);
    },
  };
}

function toBody(input: GenerateInput, stream = false): InferRequest {
  const messages = input.messages ?? (input.prompt !== undefined ? [{ role: 'user' as const, content: input.prompt }] : undefined);
  if (!messages || messages.length === 0) {
    throw new AidevClientError('Provide prompt or messages', 'invalid_request');
  }
  return {
    messages,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.keep !== undefined ? { keep: input.keep } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function fromErrorBody(status: number, payload: unknown): AidevClientError {
  if (isRecord(payload)) {
    const nested = isRecord(payload.error) ? payload.error : undefined;
    const code =
      (typeof payload.error === 'string' ? payload.error : undefined) ??
      (typeof nested?.code === 'string' ? nested.code : undefined) ??
      (typeof nested?.type === 'string' ? nested.type : undefined) ??
      'request_failed';
    const message =
      (typeof payload.message === 'string' ? payload.message : undefined) ??
      (typeof nested?.message === 'string' ? nested.message : undefined) ??
      `Request failed (${status})`;
    return new AidevClientError(message, code, status, payload);
  }
  return new AidevClientError(`Request failed (${status})`, 'request_failed', status, payload);
}

async function readTokenFile(): Promise<string> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new AidevClientError(
      'Pass token or set AIDEV_TOKEN. File tokens are only read in Node.',
      'missing_token',
    );
  }
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const home = process.env.AIDEV_HOME?.trim() ? process.env.AIDEV_HOME.trim() : join(homedir(), HOME_DIRNAME);
  const file = join(home, 'token');
  try {
    const token = (await readFile(file, 'utf8')).trim();
    if (token) return token;
  } catch {
    // Fall through.
  }
  throw new AidevClientError(
    `No machine token at ${file}. Start the gateway once, or set AIDEV_TOKEN.`,
    'missing_token',
  );
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
