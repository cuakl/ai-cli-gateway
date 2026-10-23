import { z } from 'zod';
import { ProviderSchema, RunModeSchema } from './capabilities.js';
import { FrontendContextPayloadSchema } from './context.js';
import { GitDiffSummarySchema } from './diff.js';
import { UnifiedStreamEventSchema } from './events.js';
import {
  ImageAttachmentSchema,
  RunIdSchema,
  RunSchema,
  ThreadEventSchema,
  ThreadIdSchema,
  ThreadSchema,
} from './threads.js';

const requestId = z.string().min(1).optional();

function withType<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({
    type: z.literal(type),
    requestId,
    ...shape,
  });
}

/** Working tree snapshot returned by `git.status`. */
export const GitStatusSchema = z.object({
  branch: z.string().min(1),
  clean: z.boolean(),
  conflicted: z.array(z.string()),
  dirty: z.array(z.string()),
});

export type GitStatus = z.infer<typeof GitStatusSchema>;

export const GitLogEntrySchema = z.object({
  hash: z.string().min(1),
  subject: z.string(),
  at: z.number().int().nonnegative(),
});

export type GitLogEntry = z.infer<typeof GitLogEntrySchema>;

export const TestStatusSchema = z.enum(['passed', 'failed', 'cancelled']);

export type TestStatus = z.infer<typeof TestStatusSchema>;

export const TestSummarySchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});

export type TestSummary = z.infer<typeof TestSummarySchema>;

const sessionId = z.string().min(1);

/**
 * Client → gateway messages on `GET /api/v1/projects/:projectId/ws`.
 * Commands that return data are answered by a `<type>.result` server message
 * with the same `requestId`. `run.start` is answered by `run.accepted`.
 */
export const WorkspaceClientMessageSchema = z.discriminatedUnion('type', [
  withType('run.start', {
    threadId: ThreadIdSchema.optional(),
    provider: ProviderSchema,
    model: z.string().min(1).optional(),
    mode: RunModeSchema,
    prompt: z.string().min(1),
    context: FrontendContextPayloadSchema,
    attachments: z.array(ImageAttachmentSchema),
  }),
  withType('run.cancel', {
    runId: RunIdSchema,
  }),
  withType('thread.list', {}),
  withType('thread.get', {
    threadId: ThreadIdSchema,
  }),
  withType('thread.delete', {
    threadId: ThreadIdSchema,
  }),
  withType('thread.keep', {
    threadId: ThreadIdSchema,
    keep: z.boolean(),
  }),
  withType('git.status', {}),
  withType('git.diff', {
    paths: z.array(z.string().min(1)).optional(),
  }),
  withType('git.commit', {
    message: z.string().min(1),
    paths: z.array(z.string().min(1)),
    push: z.boolean(),
  }),
  withType('git.discard', {
    paths: z.array(z.string().min(1)),
  }),
  withType('git.checkpoint.restore', {
    runId: RunIdSchema,
    /** Skip the newer-run overlap check. */
    force: z.boolean().optional(),
  }),
  withType('git.log', {
    limit: z.number().int().positive(),
  }),
  withType('git.branch.create', {
    name: z.string().min(1),
  }),
  withType('git.pr.create', {
    title: z.string().min(1),
    body: z.string(),
    base: z.string().min(1),
  }),
  withType('pty.spawn', {
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  withType('pty.input', {
    sessionId,
    data: z.string(),
  }),
  withType('pty.resize', {
    sessionId,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  withType('pty.dispose', {
    sessionId,
  }),
  withType('test.run', {
    file: z.string().min(1).optional(),
    watch: z.boolean().optional(),
  }),
  withType('test.stop', {}),
  withType('commit.suggest', {
    paths: z.array(z.string().min(1)),
  }),
]);

export type WorkspaceClientMessage = z.infer<typeof WorkspaceClientMessageSchema>;

/**
 * Gateway → client messages on the project WebSocket.
 * Push events (`run.event`, `git.changed`, `pty.data`, …) may omit `requestId`.
 * `.result` messages answer the client command of the same name.
 */
export const WorkspaceServerMessageSchema = z.discriminatedUnion('type', [
  withType('run.accepted', {
    threadId: ThreadIdSchema,
    runId: RunIdSchema,
  }),
  withType('run.event', {
    runId: RunIdSchema,
    event: UnifiedStreamEventSchema,
  }),
  withType('run.finished', {
    run: RunSchema,
  }),
  withType('project.activity', {
    activeRuns: z.number().int().nonnegative(),
    /** Agent (and capacity) waiters that have been accepted but not started. */
    queuedRuns: z.number().int().nonnegative().optional(),
  }),
  withType('git.changed', {
    summary: GitDiffSummarySchema,
  }),
  withType('pty.data', {
    sessionId,
    data: z.string(),
  }),
  withType('pty.exit', {
    sessionId,
    code: z.number().int(),
  }),
  withType('test.output', {
    line: z.string(),
  }),
  withType('test.finished', {
    status: TestStatusSchema,
    summary: TestSummarySchema,
  }),
  withType('thread.list.result', {
    threads: z.array(ThreadSchema),
  }),
  withType('thread.get.result', {
    thread: ThreadSchema,
    runs: z.array(RunSchema),
    events: z.array(ThreadEventSchema),
  }),
  withType('thread.delete.result', {
    threadId: ThreadIdSchema,
  }),
  withType('thread.keep.result', {
    thread: ThreadSchema,
  }),
  withType('git.status.result', {
    status: GitStatusSchema,
  }),
  withType('git.diff.result', {
    summary: GitDiffSummarySchema,
  }),
  withType('git.commit.result', {
    commitHash: z.string().min(1),
    branch: z.string().min(1),
    pushed: z.boolean(),
  }),
  withType('git.discard.result', {
    paths: z.array(z.string()),
  }),
  withType('git.checkpoint.restore.result', {
    runId: RunIdSchema,
    files: z.array(z.string()),
  }),
  withType('git.log.result', {
    commits: z.array(GitLogEntrySchema),
  }),
  withType('git.branch.create.result', {
    name: z.string().min(1),
  }),
  withType('git.pr.create.result', {
    url: z.string().min(1),
  }),
  withType('pty.spawn.result', {
    sessionId,
    fallback: z.boolean(),
  }),
  withType('commit.suggest.result', {
    message: z.string().min(1),
  }),
  withType('error', {
    code: z.string().min(1),
    message: z.string(),
  }),
]);

export type WorkspaceServerMessage = z.infer<typeof WorkspaceServerMessageSchema>;
