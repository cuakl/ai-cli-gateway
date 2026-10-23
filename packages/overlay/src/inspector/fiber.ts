import type { ComponentLocation } from '@aidev/protocol';

interface ReactDebugSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface ReactComponentType {
  displayName?: string;
  name?: string;
}

interface ReactFiber {
  return?: ReactFiber | null;
  type?: ReactComponentType | string | null;
  elementType?: ReactComponentType | string | null;
  memoizedProps?: unknown;
  _debugSource?: ReactDebugSource | null;
}

const MAX_DEPTH = 4;
const MAX_KEYS = 20;
const MAX_STRING = 500;

/**
 * Read `_debugSource` from the React fiber attached to a DOM node.
 * Returns null when the node was not rendered by React or no debug source exists.
 */
export function getReactSource(element: Element): ComponentLocation | null {
  const fiber = findFiber(element);
  if (!fiber) return null;

  const seen = new Set<ReactFiber>();
  let current: ReactFiber | null | undefined = fiber;
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const source = current._debugSource;
    if (source?.fileName) {
      return {
        componentName: componentName(current),
        fileName: source.fileName,
        lineNumber: source.lineNumber ?? 0,
        columnNumber: source.columnNumber ?? 0,
        props: sanitizeProps(current.memoizedProps),
      };
    }
    current = current.return ?? null;
  }
  return null;
}

export function sanitizeProps(props: unknown): Record<string, unknown> {
  const safe = toJsonSafe(props, 0, new WeakSet());
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) return {};
  return safe as Record<string, unknown>;
}

function findFiber(element: Element): ReactFiber | null {
  const record = element as unknown as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.getOwnPropertyNames(element),
    ...Object.keys(record),
  ]);
  for (const key in record) keys.add(key);
  const match = [...keys].find(
    (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
  );
  if (!match) return null;
  const value = record[match];
  if (!value || typeof value !== 'object') return null;
  return value as ReactFiber;
}

function componentName(fiber: ReactFiber): string {
  const type = fiber.type ?? fiber.elementType;
  if (typeof type === 'function') {
    const named = type as ReactComponentType;
    return named.displayName || named.name || 'Component';
  }
  if (typeof type === 'string' && type) return type;
  if (type && typeof type === 'object') {
    return type.displayName || type.name || 'Component';
  }
  return 'Component';
}

function toJsonSafe(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null) return value;
  const kind = typeof value;
  if (kind === 'string') {
    const text = value as string;
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  }
  if (kind === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (kind === 'boolean') return value;
  if (kind === 'bigint') return String(value);
  if (kind === 'function') return '[function]';
  if (kind === 'symbol') return String(value);
  if (kind !== 'object') return String(value);
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof Node !== 'undefined' && value instanceof Node) return `[${value.nodeName}]`;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[max-depth]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((item) => toJsonSafe(item, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS);
  for (const [key, entry] of entries) {
    const safe = toJsonSafe(entry, depth + 1, seen);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}
