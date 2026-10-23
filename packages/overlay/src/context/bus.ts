type ContextListener = () => void;

const listeners = new Set<ContextListener>();

export function subscribeContext(listener: ContextListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyContext(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A subscriber must not break capture.
    }
  }
}
