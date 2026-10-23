import { parseDataLoc, resolveSourceLocation, type DataLoc } from './locator.js';

export const MAX_SELECTIONS = 5;

const NODE_MODULES = /(?:^|[\\/])node_modules(?:[\\/]|$)/i;

export function isUserCodePath(fileName: string): boolean {
  return fileName.length > 0 && !NODE_MODULES.test(fileName);
}

/** The element's own `data-loc` when it points at user code. */
export function ownUserLoc(element: Element): DataLoc | null {
  const loc = parseDataLoc(element.getAttribute('data-loc') ?? '');
  if (!loc || !isUserCodePath(loc.fileName)) return null;
  return loc;
}

/**
 * Ancestors (including `element`) that carry a user-code `data-loc`,
 * deepest first.
 */
export function locAncestors(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    if (ownUserLoc(current)) chain.push(current);
    current = current.parentElement;
  }
  return chain;
}

/** Deepest user-code `data-loc` node under `from`, or `from` itself. */
export function pickHoverTarget(from: Element): Element {
  return locAncestors(from)[0] ?? from;
}

export function walkUp(path: readonly Element[], index: number): number {
  if (path.length === 0) return 0;
  return Math.max(0, Math.min(index, path.length - 1) - 1);
}

export function walkDown(path: readonly Element[], index: number): number {
  if (path.length === 0) return 0;
  return Math.min(path.length - 1, Math.max(0, index) + 1);
}

/**
 * Outer-to-inner breadcrumb labels, e.g. `CardGrid › ProductCard › strong`.
 * Component names are de-duplicated; the leaf tag is always last.
 */
export function breadcrumbLabels(element: Element): string[] {
  const ancestors = locAncestors(element).slice().reverse();
  const names: string[] = [];
  for (const node of ancestors) {
    const source = resolveSourceLocation(node);
    const name = source?.componentName?.trim() || node.tagName.toLowerCase();
    if (names[names.length - 1] !== name) names.push(name);
  }
  const tag = element.tagName.toLowerCase();
  if (names[names.length - 1] !== tag) names.push(tag);
  if (names.length === 0) names.push(tag);
  return names;
}

export function breadcrumbAncestors(element: Element): Element[] {
  return locAncestors(element).slice().reverse();
}

export function sameElement(left: Element, right: Element): boolean {
  return left === right;
}

export function appendSelection(current: readonly Element[], next: Element, limit = MAX_SELECTIONS): Element[] {
  if (current.some((item) => item === next)) return [...current];
  if (current.length >= limit) return [...current];
  return [...current, next];
}
