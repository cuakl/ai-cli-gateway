import { z } from 'zod';

export const OpenAIContentPartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z
      .object({
        url: z.string().min(1),
      })
      .passthrough(),
  }),
]);

export type OpenAIContentPart = z.infer<typeof OpenAIContentPartSchema>;

export const OpenAIChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'developer']),
    content: z.union([z.string(), z.array(OpenAIContentPartSchema)]).nullable(),
  })
  .passthrough();

export type OpenAIChatMessage = z.infer<typeof OpenAIChatMessageSchema>;

/**
 * Body of `POST /v1/chat/completions`. Extra OpenAI fields are ignored.
 * `tools` / `functions` are rejected by the route, not this schema.
 */
export const OpenAIChatCompletionRequestSchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(OpenAIChatMessageSchema).min(1),
    stream: z.boolean().optional(),
    response_format: z
      .object({
        type: z.enum(['text', 'json_object', 'json_schema']),
        json_schema: z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
            schema: z.record(z.string(), z.unknown()),
            strict: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type OpenAIChatCompletionRequest = z.infer<typeof OpenAIChatCompletionRequestSchema>;

export const OpenAIModelSchema = z.object({
  id: z.string().min(1),
  object: z.literal('model'),
  owned_by: z.string().min(1),
  created: z.number().int().nonnegative().optional(),
});

export type OpenAIModel = z.infer<typeof OpenAIModelSchema>;

export const OpenAIModelListSchema = z.object({
  object: z.literal('list'),
  data: z.array(OpenAIModelSchema),
});

export type OpenAIModelList = z.infer<typeof OpenAIModelListSchema>;
