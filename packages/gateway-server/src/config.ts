import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  /** Directory that prompt cwd and file paths must stay inside. */
  root: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4100;

/**
 * Host defaults to loopback so a dev gateway is not reachable from the network.
 * `PORT` selects the TCP port (default 4100). `HOST` overrides the bind address.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    root: readRoot(env.GATEWAY_ROOT),
  };
}

function readHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : DEFAULT_HOST;
}

/**
 * `GATEWAY_ROOT` wins. Otherwise the git toplevel of the process directory is
 * the project, so a server started from a package can still edit that repo.
 */
function readRoot(value: string | undefined): string {
  const explicit = value?.trim();
  if (explicit) return existingDirectory(path.resolve(explicit), 'GATEWAY_ROOT');
  const cwd = process.cwd();
  return gitToplevel(cwd) ?? existingDirectory(cwd, 'current directory');
}

function existingDirectory(directory: string, label: string): string {
  try {
    return realpathSync(directory);
  } catch {
    throw new Error(`${label} does not exist: ${directory}`);
  }
}

function gitToplevel(cwd: string): string | null {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return top ? realpathSync(top) : null;
  } catch {
    return null;
  }
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT "${value}". Expected an integer from 0 to 65535.`);
  }
  return port;
}
