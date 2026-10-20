/** How long to wait after the last full reload before letting the browser refresh. */
export const DEFAULT_RELOAD_DEBOUNCE_MS = 250;

export interface HmrGuard {
  /** Hold full page reloads while an agent is writing files. */
  begin(): void;
  /** Release the hold. One reload is sent after the debounce, if any were queued. */
  end(): void;
}

interface SendTarget {
  send(...args: unknown[]): void;
}

/**
 * Coalesce Vite `full-reload` messages while a prompt is running.
 * Module HMR updates still go through immediately. Rapid multi-file writes
 * therefore update the page once, after the burst settles.
 */
export function createHmrGuard(ws: Partial<SendTarget>, debounceMs = DEFAULT_RELOAD_DEBOUNCE_MS): HmrGuard {
  if (typeof ws.send !== 'function') {
    return { begin() {}, end() {} };
  }
  const original = ws.send.bind(ws);

  let holds = 0;
  let timer: NodeJS.Timeout | null = null;
  let pending: unknown[] | null = null;

  ws.send = (...args: unknown[]) => {
    if (holds > 0 && isFullReload(args[0])) {
      pending = args;
      schedule();
      return;
    }
    original(...args);
  };

  return {
    begin() {
      holds += 1;
    },
    end() {
      holds = Math.max(0, holds - 1);
      if (holds === 0 && pending) schedule();
    },
  };

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  function flush(): void {
    timer = null;
    if (holds > 0) {
      if (pending) schedule();
      return;
    }
    const next = pending;
    pending = null;
    if (next) original(...next);
  }
}

export function isFullReload(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'full-reload');
}
