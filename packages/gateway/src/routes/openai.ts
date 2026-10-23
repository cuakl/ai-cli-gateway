import {
  OpenAIChatCompletionRequestSchema,
  ProviderTypeSchema,
  type InferImage,
  type InferMessage,
  type InferRequest,
  type InferResponse,
  type OpenAIChatCompletionRequest,
  type OpenAIChatMessage,
  type ProviderType,
} from '@aidev/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requirePrincipal, sendForbidden, type Principal } from '../auth/principal.js';
import { HttpError } from '../errors.js';
import {
  beginInfer,
  cleanupInfer,
  completeInfer,
  streamInfer,
  type InferStreamSink,
} from '../inference/run.js';
import { sseHeaders } from '../sse.js';
import type { ServerDeps } from '../types.js';

const JSON_OBJECT_SCHEMA: Record<string, unknown> = { type: 'object' };

export function registerOpenAiRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/v1/models', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      if (principal.kind === 'browser') return sendOpenAiForbidden(reply);
      const listed = await deps.runtime.listCapabilities();
      const data: Array<{ id: string; object: 'model'; owned_by: string; created: number }> = [];
      for (const cap of listed) {
        data.push({ id: cap.provider, object: 'model', owned_by: cap.provider, created: 0 });
        for (const model of cap.models) {
          data.push({
            id: `${cap.provider}/${model.id}`,
            object: 'model',
            owned_by: cap.provider,
            created: 0,
          });
        }
      }
      return { object: 'list' as const, data };
    } catch (error) {
      if (error instanceof HttpError) return sendOpenAiHttpError(reply, error);
      throw error;
    }
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    try {
      const principal = requirePrincipal(request);
      if (principal.kind === 'browser') return sendOpenAiForbidden(reply);
      rejectTools(request.body);
      const openai = readOpenAiRequest(request.body);
      const mapped = toInferRequest(openai);
      return await handleOpenAi(deps, openai, mapped, principal, reply);
    } catch (error) {
      if (error instanceof HttpError) return sendOpenAiHttpError(reply, error);
      throw error;
    }
  });
}

export function readOpenAiRequest(body: unknown): OpenAIChatCompletionRequest {
  const parsed = OpenAIChatCompletionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request';
    throw new HttpError(400, 'validation_error', message, parsed.error.issues);
  }
  return parsed.data;
}

function rejectTools(body: unknown): void {
  if (!isRecord(body)) return;
  if ('tools' in body || 'functions' in body) {
    throw new HttpError(
      400,
      'invalid_request_error',
      'Tool calling is not supported. Omit `tools` and `functions`.',
    );
  }
}

async function handleOpenAi(
  deps: ServerDeps,
  openai: OpenAIChatCompletionRequest,
  body: InferRequest,
  principal: Principal,
  reply: FastifyReply,
): Promise<unknown> {
  const modelId = displayModel(openai.model, body.provider, body.model);
  const setup = await beginInfer(deps, body, 'openai');
  try {
    if (openai.stream === true && body.jsonSchema === undefined) {
      await streamInfer(deps, principal, setup, openAiSink(reply, setup.runId, modelId));
      return;
    }
    const result = await completeInfer(deps, principal, setup);
    if (result.kind === 'structured_error') {
      return reply.code(422).send(
        openAiErrorPayload(
          'The model did not return valid JSON matching the schema',
          'invalid_request_error',
          'invalid_structured_output',
        ),
      );
    }
    if (openai.stream === true) {
      writeBufferedOpenAiSse(reply, setup.runId, modelId, completionContent(result.response));
      return;
    }
    return toChatCompletion(setup.runId, modelId, result.response);
  } finally {
    await cleanupInfer(setup);
  }
}

export function toInferRequest(body: OpenAIChatCompletionRequest): InferRequest {
  const { provider, model } = parseOpenAiModel(body.model);
  const { messages, system, images } = flattenMessages(body.messages);
  const jsonSchema = jsonSchemaOf(body);
  return {
    messages,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(system ? { system } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(jsonSchema ? { jsonSchema } : {}),
    ...(body.stream === true ? { stream: true } : {}),
  };
}

export function parseOpenAiModel(model: string | undefined): {
  provider?: ProviderType;
  model?: string;
} {
  const raw = model?.trim();
  if (!raw || raw === 'default') return {};
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return { provider: asProvider(raw) };
  }
  const provider = asProvider(raw.slice(0, slash));
  const rest = raw.slice(slash + 1).trim();
  return rest ? { provider, model: rest } : { provider };
}

function asProvider(value: string): ProviderType {
  const parsed = ProviderTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation_error',
      `Unknown model "${value}". Use "<provider>/<model>", "<provider>", or omit / "default".`,
    );
  }
  return parsed.data;
}

function flattenMessages(messages: OpenAIChatMessage[]): {
  messages: InferMessage[];
  system?: string;
  images: InferImage[];
} {
  const systemParts: string[] = [];
  const mapped: InferMessage[] = [];
  const images: InferImage[] = [];
  for (const message of messages) {
    const { text, dataUrls } = contentParts(message.content);
    for (const dataUrl of dataUrls) images.push({ dataUrl });
    if (message.role === 'system' || message.role === 'developer') {
      if (text) systemParts.push(text);
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant') {
      mapped.push({ role: message.role, content: text });
    }
  }
  if (!mapped.some((message) => message.role === 'user')) {
    throw new HttpError(400, 'validation_error', 'messages: at least one user message is required');
  }
  return {
    messages: mapped,
    images,
    ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
  };
}

function contentParts(content: OpenAIChatMessage['content']): { text: string; dataUrls: string[] } {
  if (typeof content === 'string') return { text: content, dataUrls: [] };
  if (!Array.isArray(content)) return { text: '', dataUrls: [] };
  const texts: string[] = [];
  const dataUrls: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) texts.push(part.text);
      continue;
    }
    const url = part.image_url.url.trim();
    if (!url.startsWith('data:')) {
      throw new HttpError(
        400,
        'validation_error',
        'image_url.url must be a data: URL (png, jpeg, webp, or gif)',
      );
    }
    dataUrls.push(url);
  }
  return { text: texts.join('\n'), dataUrls };
}

function jsonSchemaOf(body: OpenAIChatCompletionRequest): Record<string, unknown> | undefined {
  const format = body.response_format;
  if (!format || format.type === 'text') return undefined;
  if (format.type === 'json_object') return JSON_OBJECT_SCHEMA;
  const schema = format.json_schema?.schema;
  if (!schema) {
    throw new HttpError(
      400,
      'validation_error',
      'response_format.json_schema.schema is required when type is json_schema',
    );
  }
  return schema;
}

function displayModel(
  requested: string | undefined,
  provider: ProviderType | undefined,
  model: string | undefined,
): string {
  const raw = requested?.trim();
  if (raw && raw !== 'default') return raw;
  if (provider && model) return `${provider}/${model}`;
  if (provider) return provider;
  return 'default';
}

function completionContent(response: InferResponse): string {
  if (response.object !== undefined) {
    try {
      return JSON.stringify(response.object);
    } catch {
      return response.text;
    }
  }
  return response.text;
}

function toChatCompletion(runId: string, model: string, response: InferResponse) {
  const content = completionContent(response);
  return {
    id: chatId(runId),
    object: 'chat.completion' as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function chatId(runId: string): string {
  return `chatcmpl-${runId}`;
}

function openAiSink(reply: FastifyReply, runId: string, model: string): InferStreamSink {
  const id = chatId(runId);
  const created = Math.floor(Date.now() / 1000);
  let first = true;
  const write = (payload: unknown): void => {
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  return {
    open() {
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders(reply));
    },
    delta(text) {
      if (first) {
        first = false;
        write(chunkFrame(id, created, model, { role: 'assistant', content: text }, null));
        return;
      }
      write(chunkFrame(id, created, model, { content: text }, null));
    },
    done() {
      if (first) {
        first = false;
        write(chunkFrame(id, created, model, { role: 'assistant', content: '' }, null));
      }
      write(chunkFrame(id, created, model, {}, 'stop'));
      reply.raw.write('data: [DONE]\n\n');
    },
    error(error) {
      write(
        openAiErrorPayload(
          error.message,
          error.statusCode === 429 ? 'rate_limit_error' : 'api_error',
          error.code,
        ),
      );
    },
    close() {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        try {
          reply.raw.end();
        } catch {
          // Already gone.
        }
      }
    },
  };
}

function writeBufferedOpenAiSse(reply: FastifyReply, runId: string, model: string, text: string): void {
  const sink = openAiSink(reply, runId, model);
  sink.open();
  try {
    if (text) sink.delta(text);
    sink.done({
      id: runId,
      provider: 'cursor',
      model,
      text,
      durationMs: 0,
      threadId: '',
    });
  } finally {
    sink.close();
  }
}

function chunkFrame(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: 'stop' | null,
) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function sendOpenAiHttpError(reply: FastifyReply, error: HttpError) {
  const status = error.statusCode;
  if (status === 429) reply.header('Retry-After', '5');
  const type =
    status === 429
      ? 'rate_limit_error'
      : status >= 500
        ? 'api_error'
        : error.code === 'unauthorized'
          ? 'invalid_request_error'
          : 'invalid_request_error';
  return reply.code(status).send(openAiErrorPayload(error.message, type, error.code));
}

export function sendOpenAiForbidden(reply: FastifyReply) {
  return reply.code(403).send(
    openAiErrorPayload('Browser tokens cannot call the OpenAI-compatible API.', 'invalid_request_error'),
  );
}

export function openAiErrorPayload(
  message: string,
  type: string,
  code?: string,
): { error: { message: string; type: string; code?: string } } {
  return {
    error: {
      message,
      type,
      ...(code ? { code } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
