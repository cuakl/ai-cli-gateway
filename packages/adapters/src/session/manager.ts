import type { ManagedProcessOptions } from './process.js';
import { ManagedProcess } from './process.js';

/**
 * Registry of live CLI child processes. One active process per session id.
 * Arguments are always passed as an argv array, never through a shell.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  start(options: ManagedProcessOptions): Promise<number> {
    if (!options.sessionId) {
      return Promise.reject(new Error('sessionId is required'));
    }
    if (this.processes.has(options.sessionId)) {
      return Promise.reject(new Error(`Session ${options.sessionId} is already running`));
    }

    const managed = new ManagedProcess(options);
    this.processes.set(options.sessionId, managed);
    return managed.start().finally(() => {
      if (this.processes.get(options.sessionId) === managed) {
        this.processes.delete(options.sessionId);
      }
    });
  }

  kill(sessionId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const managed = this.processes.get(sessionId);
    if (!managed) return false;
    return managed.kill(signal);
  }

  has(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  get(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId);
  }

  activeSessions(): string[] {
    return [...this.processes.keys()];
  }
}
