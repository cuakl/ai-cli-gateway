/** A run whose CLI process is still in this gateway process. */
export interface ActiveRun {
  runId: string;
  threadId: string;
  sessionId: string;
  /** Resolves after the run record has been saved and the tracker entry removed. */
  settled: Promise<void>;
}

/**
 * In-memory index of runs that can still emit events.
 * Disk is the source of truth after the process exits.
 */
export class ActiveRuns {
  private readonly byRun = new Map<string, ActiveRun>();
  private readonly byThread = new Map<string, string>();

  add(run: ActiveRun): void {
    this.byRun.set(run.runId, run);
    this.byThread.set(run.threadId, run.runId);
  }

  remove(runId: string): void {
    const run = this.byRun.get(runId);
    if (!run) return;
    this.byRun.delete(runId);
    if (this.byThread.get(run.threadId) === runId) this.byThread.delete(run.threadId);
  }

  get(runId: string): ActiveRun | undefined {
    return this.byRun.get(runId);
  }

  forThread(threadId: string): ActiveRun | undefined {
    const runId = this.byThread.get(threadId);
    return runId ? this.byRun.get(runId) : undefined;
  }
}
