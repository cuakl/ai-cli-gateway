import { z } from 'zod';
import { ProviderTypeSchema } from './prompt.js';

export const SessionStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'killed',
  'timed_out',
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionRecordSchema = z.object({
  id: z.string().min(1),
  provider: ProviderTypeSchema,
  cwd: z.string().min(1),
  status: SessionStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  ephemeral: z.boolean().optional(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
