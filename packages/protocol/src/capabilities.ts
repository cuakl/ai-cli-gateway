import { z } from 'zod';

/** CLI the gateway can shell out to. Same set as `ProviderType`. */
export const ProviderSchema = z.enum(['cursor', 'claude', 'codex', 'antigravity']);

export type Provider = z.infer<typeof ProviderSchema>;

/** `ask` and `plan` are read-only. `agent` may edit the project. */
export const RunModeSchema = z.enum(['agent', 'ask', 'plan']);

export type RunMode = z.infer<typeof RunModeSchema>;

export const ProviderModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderCapabilitiesSchema = z.object({
  provider: ProviderSchema,
  available: z.boolean(),
  binaryPath: z.string().nullable(),
  version: z.string().nullable(),
  verified: z.boolean(),
  modes: z.array(RunModeSchema),
  models: z.array(ProviderModelSchema),
  supportsResume: z.boolean(),
  supportsImages: z.boolean(),
  supportsJsonSchema: z.boolean(),
  supportsSystemPrompt: z.boolean(),
  /** Shown when the CLI is missing or signed out. */
  setup: z.array(z.string()).optional(),
});

export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;
