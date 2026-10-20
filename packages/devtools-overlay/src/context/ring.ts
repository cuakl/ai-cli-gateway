export const CONTEXT_BUFFER_LIMIT = 50;

export interface RingBuffer<T> {
  push(item: T): void;
  snapshot(): T[];
  clear(): void;
}

export function createRingBuffer<T>(capacity = CONTEXT_BUFFER_LIMIT): RingBuffer<T> {
  const items: T[] = [];
  return {
    push(item: T): void {
      items.push(item);
      if (items.length > capacity) items.splice(0, items.length - capacity);
    },
    snapshot(): T[] {
      return items.slice();
    },
    clear(): void {
      items.length = 0;
    },
  };
}
