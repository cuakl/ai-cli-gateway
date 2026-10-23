import { WebSocket, type RawData } from 'ws';

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5_000;

export interface ProjectActivitySubscription {
  close(): void;
}

/**
 * Subscribe to `project.activity` on the project workspace socket.
 * The machine token is sent as `?token=`. Reconnects with backoff if the gateway drops.
 */
export function subscribeProjectActivity(options: {
  gatewayUrl: string;
  projectId: string;
  token: string;
  onActivity: (activeRuns: number) => void;
}): ProjectActivitySubscription {
  let stopped = false;
  let current: WebSocket | null = null;
  let delayMs = RECONNECT_MIN_MS;
  let timer: NodeJS.Timeout | null = null;

  const schedule = (): void => {
    if (stopped || timer) return;
    const wait = delayMs;
    delayMs = Math.min(delayMs * 2, RECONNECT_MAX_MS);
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, wait);
  };

  const connect = (): void => {
    if (stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(projectSocketUrl(options.gatewayUrl, options.projectId, options.token));
    } catch {
      schedule();
      return;
    }
    current = socket;
    socket.on('open', () => {
      if (current !== socket) return;
      delayMs = RECONNECT_MIN_MS;
    });
    socket.on('message', (data) => {
      if (current !== socket) return;
      const activeRuns = readActiveRuns(data);
      if (activeRuns !== null) options.onActivity(activeRuns);
    });
    const fail = (): void => {
      if (stopped || current !== socket) return;
      current = null;
      schedule();
    };
    socket.on('close', fail);
    socket.on('error', fail);
  };

  connect();

  return {
    close() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const socket = current;
      current = null;
      socket?.close();
    },
  };
}

export function projectSocketUrl(gatewayUrl: string, projectId: string, token: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/api/v1/projects/${encodeURIComponent(projectId)}/ws`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
}

function readActiveRuns(data: RawData): number | null {
  const text = rawText(data);
  if (!text) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { type?: unknown; activeRuns?: unknown };
  if (record.type !== 'project.activity') return null;
  if (typeof record.activeRuns !== 'number' || !Number.isInteger(record.activeRuns) || record.activeRuns < 0) {
    return null;
  }
  return record.activeRuns;
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return '';
}
