import { cancelSession } from '../execute.js';
import type { ServerDeps } from '../types.js';
import { pruneThreadCheckpoints } from './restore.js';

/** Cancel the active run, wait until its record is saved, then delete both files. */
export async function deleteThreadFully(deps: ServerDeps, threadId: string): Promise<boolean> {
  const existing = await deps.threads.getThread(threadId);
  if (!existing) return false;
  const active = deps.runs.forThread(threadId);
  if (active) {
    await cancelSession(deps.registry, active.sessionId);
    await active.settled;
  }
  for (const run of existing.runs) {
    deps.scheduler.cancel(run.id);
  }
  await pruneThreadCheckpoints(deps, threadId);
  return deps.threads.deleteThread(threadId);
}
