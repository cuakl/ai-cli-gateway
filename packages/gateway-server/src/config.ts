export interface ServerConfig {
  host: string;
  port: number;
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
  };
}

function readHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : DEFAULT_HOST;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT "${value}". Expected an integer from 0 to 65535.`);
  }
  return port;
}
