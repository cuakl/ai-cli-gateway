import type { FailedNetworkRequest } from '@aidev/protocol';
import { notifyContext } from './bus.js';
import { redactUrl } from './redact.js';
import { createRingBuffer, type RingBuffer } from './ring.js';

export interface StoredFailure extends FailedNetworkRequest {
  timestamp: number;
}

const BODY_LIMIT = 500;
const TEXT_BODY = /json|text|javascript|xml|svg/i;

const failures: RingBuffer<StoredFailure> = createRingBuffer();
let installed = false;
let gatewayOrigin: string | null = null;
let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string; started: number }>();

export function installNetworkCapture(gatewayUrl?: string): void {
  gatewayOrigin = originOf(gatewayUrl);
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (typeof window.fetch === 'function') {
    originalFetch = window.fetch.bind(window);
    window.fetch = patchedFetch as typeof window.fetch;
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    originalXhrOpen = XMLHttpRequest.prototype.open;
    originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = patchedOpen as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = patchedSend;
  }
}

export function uninstallNetworkCapture(): void {
  if (installed && originalFetch) window.fetch = originalFetch;
  if (installed && originalXhrOpen) XMLHttpRequest.prototype.open = originalXhrOpen;
  if (installed && originalXhrSend) XMLHttpRequest.prototype.send = originalXhrSend;
  installed = false;
  originalFetch = null;
  originalXhrOpen = null;
  originalXhrSend = null;
  gatewayOrigin = null;
  failures.clear();
}

export function getFailedNetworkRequests(): FailedNetworkRequest[] {
  return failures.snapshot().map(toRequest);
}

export function getStoredFailedNetworkRequests(): StoredFailure[] {
  return failures.snapshot();
}

export function getRecentFailedNetworkRequests(maxAgeMs: number, now = Date.now()): FailedNetworkRequest[] {
  return failures
    .snapshot()
    .filter((entry) => now - entry.timestamp <= maxAgeMs)
    .map(toRequest);
}

async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  const method = requestMethod(input, init);
  const url = requestUrl(input);
  try {
    const response = await originalFetch!(input, init);
    if (response.status >= 400) {
      const bodyPreview = await readResponsePreview(response);
      recordFailure(url, response.status, started, method, bodyPreview);
    }
    return response;
  } catch (error) {
    recordFailure(url, 0, started, method);
    throw error;
  }
}

function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
  xhrMeta.set(this, { method: method.toUpperCase(), url: String(url), started: 0 });
  originalXhrOpen!.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>);
}

function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
  const meta = xhrMeta.get(this);
  if (meta) meta.started = performance.now();
  this.addEventListener('loadend', () => {
    const recorded = xhrMeta.get(this);
    if (!recorded) return;
    const status = this.status;
    if (status < 400 && status !== 0) return;
    const bodyPreview = status >= 400 ? readXhrPreview(this) : undefined;
    recordFailure(recorded.url, status, recorded.started, recorded.method, bodyPreview);
  });
  originalXhrSend!.call(this, body);
}

function recordFailure(
  url: string,
  status: number,
  started: number,
  method?: string,
  bodyPreview?: string,
): void {
  if (isGatewayUrl(url)) return;
  failures.push({
    url: redactUrl(url),
    status,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    timestamp: Date.now(),
    ...(method ? { method } : {}),
    ...(bodyPreview ? { bodyPreview: bodyPreview.slice(0, BODY_LIMIT) } : {}),
  });
  notifyContext();
}

function toRequest(entry: StoredFailure): FailedNetworkRequest {
  return {
    url: entry.url,
    status: entry.status,
    durationMs: entry.durationMs,
    ...(entry.method ? { method: entry.method } : {}),
    ...(entry.bodyPreview ? { bodyPreview: entry.bodyPreview } : {}),
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

async function readResponsePreview(response: Response): Promise<string | undefined> {
  const type = response.headers.get('content-type') ?? '';
  if (type && !TEXT_BODY.test(type)) return undefined;
  try {
    const text = await response.clone().text();
    if (!text) return undefined;
    return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT) : text;
  } catch {
    return undefined;
  }
}

function readXhrPreview(xhr: XMLHttpRequest): string | undefined {
  const type = xhr.getResponseHeader('content-type') ?? '';
  if (type && !TEXT_BODY.test(type)) return undefined;
  try {
    const text = xhr.responseText;
    if (!text) return undefined;
    return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT) : text;
  } catch {
    return undefined;
  }
}

function originOf(gatewayUrl: string | undefined): string | null {
  if (!gatewayUrl) return null;
  try {
    return new URL(gatewayUrl).origin;
  } catch {
    return null;
  }
}

function isGatewayUrl(url: string): boolean {
  if (!gatewayOrigin) return false;
  try {
    return new URL(url, window.location.href).origin === gatewayOrigin;
  } catch {
    return false;
  }
}
