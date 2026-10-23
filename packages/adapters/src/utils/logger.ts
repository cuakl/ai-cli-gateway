export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function isLevel(value: string): value is LogLevel {
  return value in RANK;
}

function resolveLevel(): LogLevel {
  const configured = process.env.GATEWAY_LOG_LEVEL?.toLowerCase();
  if (configured && isLevel(configured)) return configured;
  if (process.env.VITEST) return 'silent';
  return 'info';
}

function write(level: LogLevel, message: string): void {
  if (RANK[level] < RANK[resolveLevel()]) return;
  const line = `[gateway] ${message}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug(message: string): void {
    write('debug', message);
  },
  info(message: string): void {
    write('info', message);
  },
  warn(message: string): void {
    write('warn', message);
  },
  error(message: string): void {
    write('error', message);
  },
};
