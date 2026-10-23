import { logger } from '@aidev/adapters';
import { readConfig } from '../home.js';
import type { ServerDeps } from '../types.js';
import { deleteThreadFully } from './control.js';

export const DEFAULT_RETENTION_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Delete expired `keep: false` threads now, then again every hour.
 * The timer does not keep the process alive. Call the returned function on shutdown.
 */
export async function startRetention(deps: ServerDeps): Promise<() => void> {
  await purgeOnce(deps);
  const timer = setInterval(() => {
    void purgeOnce(deps);
  }, HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}

async function purgeOnce(deps: ServerDeps): Promise<void> {
  try {
    const config = await readConfig(deps.home);
    const days = config.retentionDays ?? DEFAULT_RETENTION_DAYS;
    if (!Number.isInteger(days) || days < 1) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    const threads = await deps.threads.listThreads({});
    for (const thread of threads) {
      if (thread.keep || thread.updatedAt >= cutoff) continue;
      if (await deleteThreadFully(deps, thread.id)) removed.push(thread.id);
    }
    if (removed.length > 0) logger.info(`removed ${removed.length} expired thread(s)`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'retention failed');
  }
}
