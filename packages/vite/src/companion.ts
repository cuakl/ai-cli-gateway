import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

const HEALTH_DEADLINE_MS = 5_000;
const HEALTH_POLL_MS = 200;
const HEALTH_PROBE_MS = 1_000;

export function gatewayStartHint(gatewayUrl: string): string {
  return `[ai-devtools] Gateway at ${gatewayUrl} is not running. Start it with: npx aidev start`;
}

/** Absolute path of the `aidev` CLI shipped by `@aidev/gateway`. */
export function resolveGatewayBin(): string {
  const pkgPath = require.resolve('@aidev/gateway/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: string | { aidev?: string } };
  const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.aidev;
  if (!relative) throw new Error('@aidev/gateway is missing the aidev bin');
  return path.resolve(path.dirname(pkgPath), relative);
}

export interface EnsureGatewayOptions {
  gatewayUrl: string;
  autoStart: boolean;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  log?: (line: string) => void;
  /** How long to poll `/health` after spawning. Defaults to 5s. */
  deadlineMs?: number;
  resolveBin?: () => string;
}

/**
 * Return true when the gateway answers `/health`.
 * When it does not, and `autoStart` is set, spawn `aidev start --detach` and poll.
 * Otherwise log one line that includes `npx aidev start`.
 */
export async function ensureGateway(options: EnsureGatewayOptions): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((line: string) => console.warn(line));
  if (await probeHealth(options.gatewayUrl, fetchImpl)) return true;
  if (!options.autoStart) {
    log(gatewayStartHint(options.gatewayUrl));
    return false;
  }
  try {
    const bin = (options.resolveBin ?? resolveGatewayBin)();
    const args = [bin, 'start', '--detach'];
    const port = portFromGatewayUrl(options.gatewayUrl);
    if (port) args.push('--port', port);
    const child: ChildProcess = (options.spawnImpl ?? spawn)(
      process.execPath,
      args,
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    child.on('error', () => {
      // The health poll below reports a gateway that never comes up.
    });
    child.unref();
  } catch {
    log(gatewayStartHint(options.gatewayUrl));
    return false;
  }
  const up = await waitForHealth(options.gatewayUrl, fetchImpl, options.deadlineMs ?? HEALTH_DEADLINE_MS);
  if (!up) log(gatewayStartHint(options.gatewayUrl));
  return up;
}

async function probeHealth(gatewayUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_MS);
  try {
    const response = await fetchImpl(new URL('/health', `${gatewayUrl.replace(/\/$/, '')}/`), {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(gatewayUrl: string, fetchImpl: typeof fetch, deadlineMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (await probeHealth(gatewayUrl, fetchImpl)) return true;
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) break;
    await delay(Math.min(HEALTH_POLL_MS, remaining));
  }
  return false;
}

function portFromGatewayUrl(gatewayUrl: string): string | undefined {
  try {
    const port = new URL(gatewayUrl).port;
    return port || undefined;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
