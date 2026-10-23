import { z } from 'zod';
import { ProviderSchema } from './capabilities.js';
import { ProjectSchema } from './projects.js';

/**
 * Body of `POST /api/v1/projects/register`.
 * The machine token is required on the request; it is not part of this body.
 */
export const ProjectRegisterRequestSchema = z.object({
  root: z.string().min(1),
  origin: z.string().min(1),
  allowRemoteShell: z.boolean().optional(),
});

export type ProjectRegisterRequest = z.infer<typeof ProjectRegisterRequestSchema>;

export const ProjectRegisterResponseSchema = z.object({
  projectId: z.string().min(1),
  browserToken: z.string().min(1),
});

export type ProjectRegisterResponse = z.infer<typeof ProjectRegisterResponseSchema>;

/**
 * Shape of `~/.aidev/config.json` (`AIDEV_HOME` overrides the directory).
 * Omitted fields are filled by the gateway when it writes the file.
 */
export const AidevConfigSchema = z.object({
  port: z.number().int().positive().optional(),
  projects: z.array(ProjectSchema).optional(),
  inferenceTokens: z.array(z.string().min(1)).optional(),
  retentionDays: z.number().int().positive().optional(),
  defaultProvider: ProviderSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
});

export type AidevConfig = z.infer<typeof AidevConfigSchema>;
