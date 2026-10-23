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
  /** Commits this branch is ahead of its upstream. Omitted when there is no upstream. */
  ahead: z.number().int().nonnegative().optional(),
  /** Commits this branch is behind its upstream. Omitted when there is no upstream. */
  behind: z.number().int().nonnegative().optional(),
  /** `gh` is on PATH and `gh auth status` succeeded (cached 60s). */
  ghAvailable: z.boolean(),
});

export type GitStatus = z.infer<typeof GitStatusSchema>;

export const GitLogEntrySchema = z.object({
  hash: z.string().min(1),
  subject: z.string(),
  at: z.number().int().nonnegative(),
  /** True when this commit is reachable from the branch upstream. */
  pushed: z.boolean(),
});

export type GitLogEntry = z.infer<typeof GitLogEntrySchema>;

export const TestStatusSchema = z.enum(['passed', 'failed', 'cancelled']);

export type TestStatus = z.infer<typeof TestStatusSchema>;

export const TestCaseStatusSchema = z.enum(['passed', 'failed', 'skipped']);

export type TestCaseStatus = z.infer<typeof TestCaseStatusSchema>;

export const TestSummarySchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});

export type TestSummary = z.infer<typeof TestSummarySchema>;

export const TestLocationSchema = z.object({
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});

export type TestLocation = z.infer<typeof TestLocationSchema>;

export const TestCaseResultSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  status: TestCaseStatusSchema,
  durationMs: z.number().nonnegative(),
  failureMessages: z.array(z.string()),
  location: TestLocationSchema.optional(),
});

export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

export const TestFileResultSchema = z.object({
  path: z.string().min(1),
  status: TestCaseStatusSchema,
  tests: z.array(TestCaseResultSchema),
});

export type TestFileResult = z.infer<typeof TestFileResultSchema>;

export const TestReportSchema = z.object({
  summary: TestSummarySchema,
  files: z.array(TestFileResultSchema),
});

export type TestReport = z.infer<typeof TestReportSchema>;

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
    context: FrontendContextPayloadSchema.optional().default({
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    }),
    attachments: z.array(ImageAttachmentSchema).optional().default([]),
  }),
  withType('run.cancel', {
    runId: RunIdSchema,
  }),
  withType('run.attach', {
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
  withType('git.discard.hunk', {
    path: z.string().min(1),
    hunkIndex: z.number().int().nonnegative(),
  }),
  withType('git.commit.undo', {}),
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
    testNamePattern: z.string().min(1).optional(),
    onlyFailed: z.boolean().optional(),
  }),
  withType('test.stop', {}),
  withType('commit.suggest', {
    paths: z.array(z.string().min(1)),
  }),
  withType('files.search', {
    query: z.string(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  withType('editor.open', {
    file: z.string().min(1),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
  }),
]);

export type WorkspaceClientMessage = z.infer<typeof WorkspaceClientMessageSchema>;

/** `thread.list.result` row: the stored thread plus how many runs it has. */
export const ThreadListItemSchema = ThreadSchema.extend({
  runCount: z.number().int().nonnegative(),
});

export type ThreadListItem = z.infer<typeof ThreadListItemSchema>;

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
    report: TestReportSchema.optional(),
  }),
  withType('thread.list.result', {
    threads: z.array(ThreadListItemSchema),
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
  withType('git.discard.hunk.result', {
    path: z.string().min(1),
    hunkIndex: z.number().int().nonnegative(),
  }),
  withType('git.commit.undo.result', {
    hash: z.string().min(1),
  }),
  withType('pty.spawn.result', {
    sessionId,
    fallback: z.boolean(),
  }),
  withType('commit.suggest.result', {
    message: z.string().min(1),
  }),
  withType('files.search.result', {
    files: z.array(z.string()),
  }),
  withType('editor.open.result', {
    file: z.string().min(1),
  }),
  withType('error', {
    code: z.string().min(1),
    message: z.string(),
  }),
]);

export type WorkspaceServerMessage = z.infer<typeof WorkspaceServerMessageSchema>;

/** Body of `POST /api/v1/projects/:projectId/open` and `editor.open`. */
export const OpenEditorRequestSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
});

export type OpenEditorRequest = z.infer<typeof OpenEditorRequestSchema>;
