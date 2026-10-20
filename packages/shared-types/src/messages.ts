import { z } from 'zod';
import { FrontendContextPayloadSchema } from './context.js';
import { UnifiedStreamEventSchema } from './events.js';
import { ProviderTypeSchema } from './prompt.js';

export const GatewayClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prompt'),
    requestId: z.string().optional(),
    provider: ProviderTypeSchema,
    cwd: z.string().min(1),
    prompt: z.string().min(1),
    sessionId: z.string().optional(),
    yolo: z.boolean().optional(),
    ephemeral: z.boolean().optional(),
    files: z.array(z.string()).optional(),
    context: FrontendContextPayloadSchema.optional(),
  }),
  z.object({
    type: z.literal('cancel'),
    requestId: z.string().optional(),
    sessionId: z.string().min(1),
  }),
]);

export type GatewayClientMessage = z.infer<typeof GatewayClientMessageSchema>;

export const GatewayServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event'),
    event: UnifiedStreamEventSchema,
  }),
  z.object({
    type: z.literal('error'),
    sessionId: z.string().optional(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('ready'),
    sessionId: z.string().min(1),
  }),
]);

export type GatewayServerMessage = z.infer<typeof GatewayServerMessageSchema>;
