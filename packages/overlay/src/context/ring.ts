export const CONTEXT_BUFFER_LIMIT = 50;

export interface RingBuffer<T> {
  push(item: T): void;
  snapshot(): T[];
  removeMatching(predicate: (item: T) => boolean): number;
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
    removeMatching(predicate: (item: T) => boolean): number {
      let removed = 0;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item !== undefined && predicate(item)) {
          items.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    },
    clear(): void {
      items.length = 0;
    },
  };
}
