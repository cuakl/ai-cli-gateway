import type { FailedNetworkRequest } from '@aidev/protocol';
import { createRingBuffer, type RingBuffer } from './ring.js';

const failures: RingBuffer<FailedNetworkRequest> = createRingBuffer();
let installed = false;
let gatewayOrigin: string | null = null;
let originalFetch: typeof window.fetch | null = null;

export function installNetworkCapture(gatewayUrl?: string): void {
  gatewayOrigin = originOf(gatewayUrl);
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  originalFetch = window.fetch.bind(window);
  installed = true;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const url = requestUrl(input);
    try {
      const response = await originalFetch!(input, init);
      if (response.status >= 400) recordFailure(url, response.status, started);
      return response;
    } catch (error) {
      recordFailure(url, 0, started);
      throw error;
    }
  }) as typeof window.fetch;
}

export function uninstallNetworkCapture(): void {
  if (installed && originalFetch) window.fetch = originalFetch;
  installed = false;
  originalFetch = null;
  gatewayOrigin = null;
  failures.clear();
}

export function getFailedNetworkRequests(): FailedNetworkRequest[] {
  return failures.snapshot();
}

function recordFailure(url: string, status: number, started: number): void {
  if (isGatewayUrl(url)) return;
  failures.push({
    url,
    status,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
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
