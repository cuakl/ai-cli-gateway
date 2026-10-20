import {
  SelectedElementSchema,
  type ComponentLocation,
  type SelectedElement,
} from '@gateway/shared-types';
import { getReactSource } from './fiber.js';

const DATA_LOC = /^(.*):(\d+):(\d+)$/;
const OUTER_HTML_LIMIT = 4_000;
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

const STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background',
  'font',
] as const;

export interface DataLoc {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export function parseDataLoc(value: string): DataLoc | null {
  const match = DATA_LOC.exec(value.trim());
  if (!match) return null;
  const fileName = match[1]?.trim() ?? '';
  const lineNumber = Number(match[2]);
  const columnNumber = Number(match[3]);
  if (!fileName || !Number.isInteger(lineNumber) || !Number.isInteger(columnNumber)) return null;
  return { fileName, lineNumber, columnNumber };
}

/** The node's `data-loc`, or the nearest ancestor that has one. */
export function readDataLoc(element: Element): DataLoc | null {
  const host = element.closest('[data-loc]');
  if (!host) return null;
  return parseDataLoc(host.getAttribute('data-loc') ?? '');
}

export function componentNameFromFile(fileName: string): string {
  const parts = fileName.split(/[/\\]/).filter(Boolean);
  const base = parts.pop() ?? fileName;
  const stem = base.replace(/\.[^.]+$/, '');
  if (stem && stem.toLowerCase() !== 'index') return stem;
  return parts.pop() || stem || 'Component';
}

/**
 * `data-loc` is the JSX callsite. Fiber contributes the component name and
 * props, and supplies the file when the attribute is absent.
 */
export function resolveSourceLocation(element: Element): ComponentLocation | undefined {
  const fiber = getReactSource(element);
  const loc = readDataLoc(element);
  if (!fiber && !loc) return undefined;
  const fileName = loc?.fileName ?? fiber?.fileName ?? '';
  if (!fileName) return undefined;
  return {
    componentName: preferredComponentName(fiber?.componentName, fileName),
    fileName,
    lineNumber: loc?.lineNumber ?? fiber?.lineNumber ?? 0,
    columnNumber: loc?.columnNumber ?? fiber?.columnNumber ?? 0,
    props: fiber?.props ?? {},
  };
}

export function readComputedStyles(element: Element): Record<string, string> {
  try {
    const view = element.ownerDocument?.defaultView ?? window;
    const styles = view.getComputedStyle(element);
    const result: Record<string, string> = {};
    for (const key of STYLE_KEYS) {
      const value = styles.getPropertyValue(key);
      if (key === 'background' && !value) {
        result.background = styles.getPropertyValue('background-color');
      } else {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function sanitizeOuterHtml(html: string, limit = OUTER_HTML_LIMIT): string {
  const cleaned = html.replace(SCRIPT_BLOCK, '').replace(EVENT_HANDLER, '');
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}<!-- truncated -->`;
}

export function locateElement(element: Element): SelectedElement {
  const sourceLocation = resolveSourceLocation(element);
  return SelectedElementSchema.parse({
    tagName: element.tagName,
    id: element.id ?? '',
    className: element.getAttribute('class') ?? '',
    outerHTML: sanitizeOuterHtml(element.outerHTML ?? ''),
    computedStyles: readComputedStyles(element),
    ...(sourceLocation ? { sourceLocation } : {}),
  });
}

/** Chip text without the surrounding brackets: `HeroButton - Hero.tsx:42`. */
export function selectionChipLabel(selected: SelectedElement): string {
  const source = selected.sourceLocation;
  if (source) {
    const file = source.fileName.split(/[/\\]/).pop() ?? source.fileName;
    return `${source.componentName} - ${file}:${source.lineNumber}`;
  }
  const id = selected.id ? `#${selected.id}` : '';
  const className = selected.className.trim().split(/\s+/).filter(Boolean)[0];
  const classPart = className ? `.${className}` : '';
  return `${selected.tagName.toLowerCase()}${id}${classPart}`;
}

function preferredComponentName(fiberName: string | undefined, fileName: string): string {
  if (fiberName && !isHostTag(fiberName)) return fiberName;
  return componentNameFromFile(fileName);
}

function isHostTag(name: string): boolean {
  return name === name.toLowerCase();
}
