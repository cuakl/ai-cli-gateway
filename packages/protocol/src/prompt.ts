import { z } from 'zod';

/** Default child-process watchdog: 5 minutes. */
export const DEFAULT_PROCESS_TIMEOUT_MS = 300_000;

export const ProviderTypeSchema = z.enum(['cursor', 'antigravity', 'claude', 'codex']);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const PromptOptionsSchema = z.object({
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  allowedTools: z.array(z.string()).optional(),
  yolo: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  files: z.array(z.string()).optional(),
  ephemeral: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type PromptOptions = z.infer<typeof PromptOptionsSchema>;

export const PromptRequestSchema = PromptOptionsSchema.extend({
  provider: ProviderTypeSchema,
});

export type PromptRequest = z.infer<typeof PromptRequestSchema>;
