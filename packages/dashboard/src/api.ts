import type { ProviderCapabilities, Run, Thread, ThreadEvent } from '@aidev/protocol';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface StatusResponse {
  status: string;
  version: string;
  activeRuns: number;
  projects: ProjectRecord[];
  providers: ProviderCapabilities[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  root: string;
  origins: string[];
  createdAt: number;
  lastSeenAt: number;
}

export interface ThreadListItem extends Thread {
  runCount: number;
}

export interface ThreadDetail {
  thread: Thread;
  runs: Run[];
  events: ThreadEvent[];
}

export interface DoctorResponse {
  version: string;
  providers: ProviderCapabilities[];
}

export interface InferDone {
  id: string;
  text: string;
  durationMs: number;
  object?: unknown;
}

export async function apiJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const record = isRecord(body) ? body : {};
    throw new ApiError(
      response.status,
      typeof record.error === 'string' ? record.error : 'request_failed',
      typeof record.message === 'string' ? record.message : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

export function fetchStatus(token: string): Promise<StatusResponse> {
  return apiJson<StatusResponse>(token, '/api/v1/status');
}

export function fetchDoctor(token: string): Promise<DoctorResponse> {
  return apiJson<DoctorResponse>(token, '/api/v1/doctor');
}

export function fetchProjects(token: string): Promise<{ projects: ProjectRecord[] }> {
  return apiJson(token, '/api/v1/projects');
}

export function fetchThreads(
  token: string,
  query: { projectId?: string; source?: string } = {},
): Promise<{ threads: ThreadListItem[] }> {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.source) params.set('source', query.source);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiJson(token, `/api/v1/threads${suffix}`);
}

export function fetchThread(token: string, id: string): Promise<ThreadDetail> {
  return apiJson(token, `/api/v1/threads/${encodeURIComponent(id)}?include=events`);
}

export function keepThread(token: string, id: string, keep: boolean): Promise<{ thread: Thread }> {
  return apiJson(token, `/api/v1/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ keep }),
  });
}

export function deleteThread(token: string, id: string): Promise<{ ok: boolean }> {
  return apiJson(token, `/api/v1/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function streamInfer(
  token: string,
  body: unknown,
  onDelta: (text: string) => void,
): Promise<InferDone> {
  const response = await fetch('/api/v1/infer', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = `Infer failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      if (text) message = text;
    }
    throw new ApiError(response.status, 'infer_failed', message);
  }
  if (!response.body) throw new ApiError(500, 'infer_failed', 'The infer response had no body');
  return readInferSse(response.body, onDelta);
}

async function readInferSse(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<InferDone> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: InferDone | null = null;
  let errorMessage = '';

  const consume = (): void => {
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim()) continue;
      const frame = parseSseBlock(block);
      if (frame.event === 'delta' && isRecord(frame.data) && typeof frame.data.text === 'string') {
        onDelta(frame.data.text);
      } else if (frame.event === 'done' && isRecord(frame.data)) {
        done = {
          id: String(frame.data.id ?? ''),
          text: String(frame.data.text ?? ''),
          durationMs: typeof frame.data.durationMs === 'number' ? frame.data.durationMs : 0,
          ...(frame.data.object !== undefined ? { object: frame.data.object } : {}),
        };
      } else if (frame.event === 'error' && isRecord(frame.data)) {
        errorMessage =
          typeof frame.data.message === 'string'
            ? frame.data.message
            : typeof frame.data.error === 'string'
              ? frame.data.error
              : 'Infer failed';
      }
    }
  };

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    consume();
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    buffer += '\n\n';
    consume();
  }
  if (errorMessage) throw new ApiError(502, 'infer_failed', errorMessage);
  if (!done) throw new ApiError(502, 'infer_failed', 'The infer stream ended without a done event');
  return done;
}

function parseSseBlock(block: string): { event: string; data: unknown } {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  return { event, data: dataLines.length > 0 ? (JSON.parse(dataLines.join('\n')) as unknown) : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
