import { z } from 'zod';

export const GitFileStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed', 'copied']);

export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;

export const GitDiffHunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  content: z.string(),
});

export type GitDiffHunk = z.infer<typeof GitDiffHunkSchema>;

export const GitDiffFileSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().optional(),
  status: GitFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean().optional(),
  patch: z.string().optional(),
  hunks: z.array(GitDiffHunkSchema).optional(),
});

export type GitDiffFile = z.infer<typeof GitDiffFileSchema>;

export const GitDiffSummarySchema = z.object({
  branch: z.string().optional(),
  files: z.array(GitDiffFileSchema),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  raw: z.string().optional(),
});

export type GitDiffSummary = z.infer<typeof GitDiffSummarySchema>;

export const GitCommitRequestSchema = z.object({
  message: z.string().min(1),
  files: z.array(z.string()).optional(),
  push: z.boolean().optional(),
});

export type GitCommitRequest = z.infer<typeof GitCommitRequestSchema>;
