import { z } from 'zod';
import { ProviderTypeSchema } from './prompt.js';

export const InferMessageRoleSchema = z.enum(['user', 'assistant', 'system']);

export type InferMessageRole = z.infer<typeof InferMessageRoleSchema>;

export const InferMessageSchema = z.object({
  role: InferMessageRoleSchema,
  content: z.string(),
});

export type InferMessage = z.infer<typeof InferMessageSchema>;

/** Image input for `/api/v1/infer`. Data URLs or local paths; written to the scratch workspace. */
export const InferImageSchema = z.union([
  z.object({ dataUrl: z.string().min(1) }).strict(),
  z.object({ path: z.string().min(1) }).strict(),
]);

export type InferImage = z.infer<typeof InferImageSchema>;

/**
 * Body of `POST /api/v1/infer`.
 * Runs in ask mode in a scratch directory. `provider` defaults to config, then
 * the first available verified CLI (Cursor when it is one of them).
 */
export const InferRequestSchema = z
  .object({
    provider: ProviderTypeSchema.optional(),
    model: z.string().min(1).optional(),
    system: z.string().optional(),
    messages: z.array(InferMessageSchema).min(1),
    jsonSchema: z.record(z.string(), z.unknown()).optional(),
    images: z.array(InferImageSchema).max(5).optional(),
    stream: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    keep: z.boolean().optional(),
  })
  .refine((value) => value.messages.some((message) => message.role === 'user'), {
    message: 'At least one user message is required',
    path: ['messages'],
  });

export type InferRequest = z.infer<typeof InferRequestSchema>;

export const InferResponseSchema = z.object({
  id: z.string().min(1),
  provider: ProviderTypeSchema,
  model: z.string(),
  text: z.string(),
  durationMs: z.number().nonnegative(),
  threadId: z.string().min(1),
  object: z.unknown().optional(),
});

export type InferResponse = z.infer<typeof InferResponseSchema>;

export const InferDeltaSchema = z.object({
  text: z.string(),
});

export type InferDelta = z.infer<typeof InferDeltaSchema>;

export const InferDoneSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  durationMs: z.number().nonnegative(),
  object: z.unknown().optional(),
});

export type InferDone = z.infer<typeof InferDoneSchema>;
