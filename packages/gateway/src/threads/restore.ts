import { logger } from '@aidev/adapters';
import type { Run, Thread } from '@aidev/protocol';
import { HttpError } from '../errors.js';
import type { ServerDeps } from '../types.js';
import { deleteCheckpointRef, getDiff, restoreCheckpointFiles } from '../workspace/git-service.js';

export interface RestoreRunResult {
  runId: string;
  files: string[];
  projectId: string | null;
}

/**
 * Put `filesTouched` back to the run's checkpoint snapshot.
 * A later run in the same project that touched any of those files is `conflict_newer_run`
 * unless `force` is set.
 */
export async function restoreRun(
  deps: ServerDeps,
  runId: string,
  options: { force?: boolean } = {},
): Promise<RestoreRunResult> {
  const found = await deps.threads.findRun(runId);
  if (!found) throw new HttpError(404, 'not_found', `Run ${runId} was not found`);
  const { thread, run } = found;
  if (!run.checkpoint) {
    throw new HttpError(409, 'no_checkpoint', `Run ${runId} has no checkpoint to restore`);
  }
  if (!options.force) {
    const newer = await newerOverlappingRun(deps, thread, run);
    if (newer) {
      throw new HttpError(
        409,
        'conflict_newer_run',
        `Run ${newer.id} later touched the same files. Pass force to restore anyway.`,
      );
    }
  }
  const root = projectRoot(deps, thread.projectId);
  if (!root) throw new HttpError(404, 'not_found', 'The project for this run is not registered');
  const files = await restoreCheckpointFiles(root, run.checkpoint, run.filesTouched);
  try {
    deps.hub.broadcast(thread.projectId ?? '', { type: 'git.changed', summary: await getDiff(root) });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'git.changed failed');
  }
  return { runId: run.id, files, projectId: thread.projectId };
}

export async function pruneThreadCheckpoints(deps: ServerDeps, threadId: string): Promise<void> {
  const record = await deps.threads.getThread(threadId);
  if (!record) return;
  const root = projectRoot(deps, record.thread.projectId);
  if (!root) return;
  for (const run of record.runs) {
    if (!run.checkpoint) continue;
    try {
      await deleteCheckpointRef(root, run.id);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : `checkpoint ${run.id} was not pruned`);
    }
  }
}

async function newerOverlappingRun(deps: ServerDeps, thread: Thread, run: Run): Promise<Run | undefined> {
  if (!thread.projectId || run.filesTouched.length === 0) return undefined;
  const wanted = new Set(run.filesTouched);
  const threads = await deps.threads.listThreads({ projectId: thread.projectId });
  const later: Run[] = [];
  for (const item of threads) {
    const record = await deps.threads.getThread(item.id);
    if (!record) continue;
    for (const other of record.runs) {
      if (other.id === run.id) continue;
      if (other.status === 'queued') continue;
      if (other.startedAt < run.startedAt) continue;
      if (other.startedAt === run.startedAt && other.id <= run.id) continue;
      if (other.filesTouched.some((file) => wanted.has(file))) later.push(other);
    }
  }
  later.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  return later[0];
}

function projectRoot(deps: ServerDeps, projectId: string | null): string | undefined {
  if (!projectId) return undefined;
  return deps.projects.get(projectId)?.root;
}
