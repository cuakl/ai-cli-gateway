import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export function scratchPath(home: string, runId: string): string {
  return path.join(home, 'scratch', runId);
}

/** Empty directory, not a git repo. */
export async function createScratch(home: string, runId: string): Promise<string> {
  const dir = scratchPath(home, runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function removeScratch(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
