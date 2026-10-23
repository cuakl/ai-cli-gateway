import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { HOME_DIRNAME } from './brand.js';

export interface RegisteredProject {
  projectId: string;
  browserToken: string;
}

/** Machine token from `AIDEV_HOME/token`, or `~/.aidev/token`. Missing file returns null. */
export async function readMachineToken(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const override = env.AIDEV_HOME?.trim();
  const home = override ? path.resolve(override) : path.join(homedir(), HOME_DIRNAME);
  try {
    const token = (await readFile(path.join(home, 'token'), 'utf8')).trim();
    return token || null;
  } catch {
    return null;
  }
}

/** Ask a running gateway for a project id and browser token. Returns null when it is down. */
export async function registerProject(options: {
  gatewayUrl: string;
  root: string;
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<RegisteredProject | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(new URL('/api/v1/projects/register', `${options.gatewayUrl}/`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ root: options.root, origin: options.origin }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { projectId?: unknown; browserToken?: unknown };
    if (typeof body.projectId !== 'string' || typeof body.browserToken !== 'string') return null;
    return { projectId: body.projectId, browserToken: body.browserToken };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
