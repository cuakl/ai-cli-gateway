import { realpathSync } from 'node:fs';
import path from 'node:path';
import { resolveAidevHome } from './home.js';

export interface ServerConfig {
  host: string;
  port: number;
  /** `AIDEV_HOME`, or `~/.aidev` when unset. Not created here. */
  home: string;
  /**
   * Set only when `GATEWAY_ROOT` is set. The server auto-registers this directory.
   * Prompt paths must sit inside a registered project.
   */
  root?: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4100;

/**
 * Host defaults to loopback so a dev gateway is not reachable from the network.
 * `PORT` selects the TCP port (default 4100). `HOST` overrides the bind address.
 * `AIDEV_HOME` overrides the config directory. `GATEWAY_ROOT`, when set, is
 * auto-registered as a project root.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = readRoot(env.GATEWAY_ROOT);
  return {
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    home: resolveAidevHome(env),
    ...(root ? { root } : {}),
  };
}

function readHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : DEFAULT_HOST;
}

/** `GATEWAY_ROOT`, when set, must be an existing directory. Unset means no auto-registered root. */
function readRoot(value: string | undefined): string | undefined {
  const explicit = value?.trim();
  if (!explicit) return undefined;
  return existingDirectory(path.resolve(explicit), 'GATEWAY_ROOT');
}

function existingDirectory(directory: string, label: string): string {
  try {
    return realpathSync(directory);
  } catch {
    throw new Error(`${label} does not exist: ${directory}`);
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
