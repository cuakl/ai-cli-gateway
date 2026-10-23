import { z } from 'zod';
import { ProviderSchema, RunModeSchema } from './capabilities.js';
import { UnifiedStreamEventSchema } from './events.js';

export const ThreadIdSchema = z.string().regex(/^thr_[A-Za-z0-9_-]+$/);

export const RunIdSchema = z.string().regex(/^run_[A-Za-z0-9_-]+$/);

/** Chip describing a selected element, without HTML or computed styles. */
export const SelectionDescriptorSchema = z.object({
  tagName: z.string().min(1),
  id: z.string().optional(),
  className: z.string().optional(),
  componentName: z.string().optional(),
  fileName: z.string().optional(),
  lineNumber: z.number().int().nonnegative().optional(),
  columnNumber: z.number().int().nonnegative().optional(),
});

export type SelectionDescriptor = z.infer<typeof SelectionDescriptorSchema>;

/**
 * What was attached to a prompt, without raw image bytes.
 * Counts are errors, console logs, and failed network requests.
 */
export const ContextSummarySchema = z.object({
  selections: z.array(SelectionDescriptorSchema),
  errorCount: z.number().int().nonnegative(),
  logCount: z.number().int().nonnegative(),
  failedRequestCount: z.number().int().nonnegative(),
  screenshotAttached: z.boolean(),
});

export type ContextSummary = z.infer<typeof ContextSummarySchema>;

export const ImageAttachmentSchema = z.object({
  kind: z.literal('image'),
  path: z.string().min(1),
  mime: z.string().min(1),
});

export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ThreadSourceSchema = z.enum(['overlay', 'api', 'openai', 'dashboard']);

export type ThreadSource = z.infer<typeof ThreadSourceSchema>;

export const RunCheckpointSchema = z.object({
  ref: z.string().min(1),
  baseHead: z.string().min(1),
  dirtyBefore: z.array(z.string()),
});

export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;

export const RunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  setup: z.array(z.string()).optional(),
});

export type RunError = z.infer<typeof RunErrorSchema>;

export const RunUsageSchema = z.object({
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

export type RunUsage = z.infer<typeof RunUsageSchema>;

export const ThreadSchema = z.object({
  id: ThreadIdSchema,
  /** `null` for inference threads, which have no project. */
  projectId: z.string().min(1).nullable(),
  provider: ProviderSchema,
  model: z.string().min(1).nullable(),
  mode: RunModeSchema,
  /** The CLI's own chat id, captured from its init event. */
  providerSessionId: z.string().min(1).nullable(),
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** `false` means the thread is eligible for retention cleanup. */
  keep: z.boolean(),
  source: ThreadSourceSchema,
});

export type Thread = z.infer<typeof ThreadSchema>;

export const RunSchema = z.object({
  id: RunIdSchema,
  threadId: ThreadIdSchema,
  /** What the user typed. */
  prompt: z.string(),
  contextSummary: ContextSummarySchema.nullable(),
  attachments: z.array(ImageAttachmentSchema),
  status: RunStatusSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  checkpoint: RunCheckpointSchema.nullable(),
  filesTouched: z.array(z.string()),
  error: RunErrorSchema.nullable(),
  usage: RunUsageSchema.nullable(),
});

export type Run = z.infer<typeof RunSchema>;

/** One JSONL line: a unified event tagged with the run that produced it. */
export const ThreadEventSchema = z.object({
  runId: RunIdSchema,
  event: UnifiedStreamEventSchema,
});

export type ThreadEvent = z.infer<typeof ThreadEventSchema>;
