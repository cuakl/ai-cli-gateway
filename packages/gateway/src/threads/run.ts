import { randomBytes } from 'node:crypto';
import { isInsideRoot } from '@aidev/adapters';
import {
  RunSchema,
  type ContextSummary,
  type ImageAttachment,
  type Run,
  type SessionStatus,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import type { ProjectRegistry } from '../projects/registry.js';

/** Fields a live execution needs in order to finish the run record. */
export interface ThreadRunBinding {
  threadId: string;
  runId: string;
  prompt: string;
  startedAt: number;
  contextSummary: ContextSummary | null;
  attachments: ImageAttachment[];
}

export function newThreadId(): string {
  return `thr_${randomBytes(12).toString('base64url')}`;
}

export function newRunId(): string {
  return `run_${randomBytes(12).toString('base64url')}`;
}

/** First prompt, collapsed to one line and cut at 80 characters. */
export function threadTitle(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function runningRun(input: {
  threadId: string;
  prompt: string;
  contextSummary: ContextSummary | null;
  attachments: ImageAttachment[];
  startedAt?: number;
}): Run {
  return RunSchema.parse({
    id: newRunId(),
    threadId: input.threadId,
    prompt: input.prompt,
    contextSummary: input.contextSummary,
    attachments: input.attachments,
    status: 'running',
    startedAt: input.startedAt ?? Date.now(),
    endedAt: null,
    checkpoint: null,
    filesTouched: [],
    error: null,
    usage: null,
  });
}

export function runFromOutcome(
  binding: ThreadRunBinding,
  outcome: {
    status: SessionStatus;
    exitCode: number;
    events: UnifiedStreamEvent[];
  },
  endedAt = Date.now(),
): Run {
  const filesTouched = [
    ...new Set(
      outcome.events.flatMap((event) =>
        event.type === 'file_edit' && event.payload.filePath ? [event.payload.filePath] : [],
      ),
    ),
  ];
  const status = runStatus(outcome.status, outcome.exitCode);
  const errorEvent = [...outcome.events].reverse().find((event) => event.type === 'error');
  const done = outcome.events.find((event) => event.type === 'done');
  const durationMs = done?.payload.durationMs ?? Math.max(0, endedAt - binding.startedAt);
  const errorText = errorEvent?.payload.error;
  return RunSchema.parse({
    id: binding.runId,
    threadId: binding.threadId,
    prompt: binding.prompt,
    contextSummary: binding.contextSummary,
    attachments: binding.attachments,
    status,
    startedAt: binding.startedAt,
    endedAt,
    checkpoint: null,
    filesTouched,
    error:
      status === 'succeeded' || !errorText
        ? null
        : {
            code: outcome.status === 'timed_out' ? 'timeout' : 'agent_error',
            message: errorText,
          },
    usage: { durationMs },
  });
}

/** Longest registered root that contains `cwd`. `cwd` should already be canonical. */
export function projectForPath(projects: ProjectRegistry, cwd: string): { id: string } | undefined {
  let best: { id: string; root: string } | undefined;
  for (const project of projects.list()) {
    if (!isInsideRoot(project.root, cwd)) continue;
    if (!best || project.root.length > best.root.length) best = project;
  }
  return best;
}

function runStatus(status: SessionStatus, exitCode: number): Run['status'] {
  if (status === 'killed') return 'cancelled';
  if (status === 'timed_out') return 'timeout';
  if (exitCode === 0 && (status === 'completed' || status === 'running')) return 'succeeded';
  return 'failed';
}
