import { z } from 'zod';
import { RunModeSchema } from './capabilities.js';

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
  /** CLI chat id captured from `session_info`. */
  providerSessionId: z.string().min(1).optional(),
  /** Model id the CLI should use. Omitted lets the CLI choose. */
  model: z.string().min(1).optional(),
  /** Omitted means `agent`. `ask` and `plan` are read-only. */
  mode: RunModeSchema.optional(),
  /**
   * JSON Schema for structured output. Claude passes `--json-schema` when the
   * adapter sets this field. Other providers ignore it; the gateway still
   * asks for JSON in the system prompt and validates the reply.
   */
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
});

export type PromptOptions = z.infer<typeof PromptOptionsSchema>;

export const PromptRequestSchema = PromptOptionsSchema.extend({
  provider: ProviderTypeSchema,
});

export type PromptRequest = z.infer<typeof PromptRequestSchema>;
