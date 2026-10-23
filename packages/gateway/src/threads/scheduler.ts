import type { RunMode } from '@aidev/protocol';

export const DEFAULT_MAX_CONCURRENT_RUNS = 4;
export const RETRY_AFTER_SECONDS = 5;

export class RunCancelledError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Run ${runId} was cancelled`);
    this.name = 'RunCancelledError';
    this.runId = runId;
  }
}

export interface RunLease {
  release: () => void;
}

interface Waiter {
  runId: string;
  projectId: string | null;
  agent: boolean;
  resolve: (lease: RunLease) => void;
  reject: (error: Error) => void;
}

/**
 * Global cap plus one agent-mode run per project.
 * HTTP callers use `tryAcquire` (429 when busy). Workspace callers `acquire` and wait FIFO.
 */
export class RunScheduler {
  private active = 0;
  private readonly activeByProject = new Map<string, number>();
  private readonly agentByProject = new Map<string, number>();
  private readonly queue: Waiter[] = [];

  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrentRuns must be a positive integer');
    }
  }

  activeCount(): number {
    return this.active;
  }

  activeFor(projectId: string): number {
    return this.activeByProject.get(projectId) ?? 0;
  }

  queuedCount(projectId?: string): number {
    if (projectId === undefined) return this.queue.length;
    return this.queue.filter((waiter) => waiter.projectId === projectId).length;
  }

  canStart(projectId: string | null, mode: RunMode): boolean {
    return this.fits(projectId, mode === 'agent');
  }

  tryAcquire(projectId: string | null, mode: RunMode): RunLease | undefined {
    const agent = mode === 'agent';
    if (!this.fits(projectId, agent)) return undefined;
    return this.take(projectId, agent);
  }

  acquire(projectId: string | null, mode: RunMode, runId: string): Promise<RunLease> {
    const agent = mode === 'agent';
    if (this.fits(projectId, agent)) return Promise.resolve(this.take(projectId, agent));
    return new Promise<RunLease>((resolve, reject) => {
      this.queue.push({ runId, projectId, agent, resolve, reject });
    });
  }

  cancel(runId: string): boolean {
    const index = this.queue.findIndex((waiter) => waiter.runId === runId);
    if (index === -1) return false;
    const waiter = this.queue.splice(index, 1)[0];
    waiter?.reject(new RunCancelledError(runId));
    return true;
  }

  private fits(projectId: string | null, agent: boolean): boolean {
    if (this.active >= this.maxConcurrent) return false;
    if (agent && projectId && (this.agentByProject.get(projectId) ?? 0) > 0) return false;
    return true;
  }

  private take(projectId: string | null, agent: boolean): RunLease {
    this.active += 1;
    if (projectId) this.activeByProject.set(projectId, (this.activeByProject.get(projectId) ?? 0) + 1);
    if (agent && projectId) this.agentByProject.set(projectId, (this.agentByProject.get(projectId) ?? 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        if (projectId) this.bump(this.activeByProject, projectId, -1);
        if (agent && projectId) this.bump(this.agentByProject, projectId, -1);
        this.pump();
      },
    };
  }

  private pump(): void {
    let index = 0;
    while (index < this.queue.length) {
      const waiter = this.queue[index];
      if (!waiter || !this.fits(waiter.projectId, waiter.agent)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      waiter.resolve(this.take(waiter.projectId, waiter.agent));
      index = 0;
    }
  }

  private bump(map: Map<string, number>, key: string, delta: number): void {
    const next = (map.get(key) ?? 0) + delta;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}
