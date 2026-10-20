import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const StreamEventTypeSchema = z.enum([
  'init',
  'chunk',
  'tool_call',
  'tool_result',
  'file_edit',
  'error',
  'done',
]);

export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;

export const StreamEventPayloadSchema = z.object({
  text: z.string().optional(),
  toolName: z.string().optional(),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
  toolOutput: z.string().optional(),
  filePath: z.string().optional(),
  error: z.string().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().nonnegative().optional(),
});

export type StreamEventPayload = z.infer<typeof StreamEventPayloadSchema>;

export const UnifiedStreamEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: StreamEventTypeSchema,
  timestamp: z.number().int().nonnegative(),
  payload: StreamEventPayloadSchema,
});

export type UnifiedStreamEvent = z.infer<typeof UnifiedStreamEventSchema>;

export function createStreamEvent(
  sessionId: string,
  type: StreamEventType,
  payload: StreamEventPayload = {},
  id: string = randomUUID(),
  timestamp: number = Date.now(),
): UnifiedStreamEvent {
  return UnifiedStreamEventSchema.parse({
    id,
    sessionId,
    type,
    timestamp,
    payload,
  });
}
