import MagicString from 'magic-string';
import { escapeAttr, filePathFromId, shouldStampFile, toProjectPath } from './loc-path.js';

export interface AidevSveltePreprocessOptions {
  /** Project root for relative `data-loc` paths. Defaults to `process.cwd()`. */
  root?: string;
}

export interface AidevMarkupInput {
  content: string;
  filename?: string;
}

export interface AidevMarkupPreprocessor {
  markup(input: AidevMarkupInput): Promise<{ code: string } | undefined>;
}

interface SvelteWalkNode {
  type?: string;
  name?: string;
  start?: number;
  attributes?: Array<{ type?: string; name?: string }>;
  [key: string]: unknown;
}

/**
 * Svelte `markup` preprocessor that stamps native elements with
 * `data-loc="relative/path.svelte:line:col"`. Components are skipped.
 * Line and column are 1-based, converted from `svelte/compiler` parse offsets.
 */
export function aidevSveltePreprocess(options: AidevSveltePreprocessOptions = {}): AidevMarkupPreprocessor {
  const root = options.root ?? process.cwd();

  return {
    async markup({ content, filename }) {
      if (!filename || !shouldStampFile(filename)) return undefined;
      const filePath = filePathFromId(filename);
      const parse = await loadSvelteParse();
      let ast: unknown;
      try {
        ast = parse(content, { filename: filePath });
      } catch {
        return undefined;
      }

      const relativePath = toProjectPath(filePath, root);
      const editor = new MagicString(content);
      let edited = false;

      walk(ast, (node) => {
        if (!isHtmlElement(node) || typeof node.start !== 'number' || !node.name) return;
        if (hasExplicitDataLoc(node)) return;
        const insertAt = node.start + 1 + node.name.length;
        if (insertAt > content.length) return;
        const { line, column } = offsetToLoc(content, node.start);
        const value = escapeAttr(`${relativePath}:${line}:${column}`);
        editor.appendLeft(insertAt, ` data-loc="${value}"`);
        edited = true;
      });

      if (!edited) return undefined;
      return { code: editor.toString() };
    },
  };
}

async function loadSvelteParse(): Promise<(source: string, opts?: { filename?: string }) => unknown> {
  try {
    const mod = (await import('svelte/compiler')) as { parse?: (source: string, opts?: { filename?: string }) => unknown };
    if (typeof mod.parse !== 'function') {
      throw new Error('svelte/compiler.parse is missing');
    }
    return mod.parse;
  } catch {
    throw new Error('aidevSveltePreprocess() requires the svelte package. Install svelte in this project.');
  }
}

function isHtmlElement(node: SvelteWalkNode): boolean {
  return node.type === 'Element' || node.type === 'RegularElement';
}

function hasExplicitDataLoc(node: SvelteWalkNode): boolean {
  return (node.attributes ?? []).some((attribute) => attribute.name === 'data-loc');
}

function offsetToLoc(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function walk(node: unknown, visit: (item: SvelteWalkNode) => void): void {
  if (!node || typeof node !== 'object') return;
  const current = node as SvelteWalkNode;
  if (typeof current.type === 'string') visit(current);
  for (const [key, value] of Object.entries(current)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}
