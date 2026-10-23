import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import { isJSXIdentifier, type JSXOpeningElement } from '@babel/types';
import MagicString from 'magic-string';
import path from 'node:path';

export interface DataLocResult {
  code: string;
  map: any;
}

type Traverse = typeof import('@babel/traverse').default;

/**
 * Babel's default export is the traverse function. Node's CJS interop sometimes
 * wraps that function in `{ default }` depending on how the package was loaded.
 */
function resolveTraverse(mod: unknown): Traverse {
  if (typeof mod === 'function') return mod as Traverse;
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const nested = (mod as { default: unknown }).default;
    if (typeof nested === 'function') return nested as Traverse;
  }
  throw new Error('Unable to load @babel/traverse');
}

const traverse = resolveTraverse(traverseModule);

/**
 * Inject `data-loc="relative/file.tsx:line:column"` onto JSX opening tags.
 * Returns null when the module is not JSX, is ignored, or needs no edits.
 * Column is Babel's 0-based `loc.start.column`. An existing `data-loc` is kept.
 */
export function injectDataLoc(code: string, id: string, rootDir: string): DataLocResult | null {
  if (isIgnoredId(id)) return null;
  const filePath = filePathFromId(id);
  if (!/\.[jt]sx$/.test(filePath)) return null;
  if (isNodeModules(filePath)) return null;

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: 'module',
      sourceFilename: filePath,
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSX parse failed';
    throw new Error(`Failed to parse ${filePath} for data-loc injection: ${message}`);
  }

  const relativePath = toProjectPath(filePath, rootDir);
  const editor = new MagicString(code);
  let edited = false;

  traverse(ast, {
    JSXOpeningElement(nodePath: NodePath<JSXOpeningElement>) {
      const opening = nodePath.node;
      if (!opening.loc) return;
      if (hasExplicitDataLoc(opening) || isFragmentName(opening)) return;
      const anchor = insertionOffset(opening);
      if (anchor == null) return;
      const { line, column } = opening.loc.start;
      const value = escapeAttr(`${relativePath}:${line}:${column}`);
      editor.appendLeft(anchor, ` data-loc="${value}"`);
      edited = true;
    },
  });

  if (!edited) return null;
  return {
    code: editor.toString(),
    map: editor.generateMap({
      hires: true,
      source: filePath,
      file: path.basename(filePath),
      includeContent: true,
    }),
  };
}

function isIgnoredId(id: string): boolean {
  return id.includes('\0') || id.startsWith('virtual:') || id.includes('/virtual:');
}

function filePathFromId(id: string): string {
  const withoutQuery = id.split('?')[0] ?? id;
  return withoutQuery.split('#')[0] ?? withoutQuery;
}

function isNodeModules(filePath: string): boolean {
  return filePath.split(/[/\\]/).includes('node_modules');
}

function toProjectPath(filePath: string, rootDir: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, absolute);
  const normalized = relative.split(path.sep).join('/');
  return normalized === '' ? path.basename(filePath) : normalized;
}

function hasExplicitDataLoc(opening: JSXOpeningElement): boolean {
  return opening.attributes.some((attribute) => {
    if (attribute.type !== 'JSXAttribute') return false;
    return isJSXIdentifier(attribute.name) && attribute.name.name === 'data-loc';
  });
}

function isFragmentName(opening: JSXOpeningElement): boolean {
  const { name } = opening;
  if (name.type === 'JSXIdentifier') return name.name === 'Fragment';
  if (name.type === 'JSXMemberExpression') {
    return isJSXIdentifier(name.property) && name.property.name === 'Fragment';
  }
  return false;
}

/**
 * Generic components (`<Select<string> />`) keep their type arguments after the
 * name. The attribute has to follow those arguments or the edit splits the tag.
 */
function insertionOffset(opening: JSXOpeningElement): number | null {
  const typed = opening as JSXOpeningElement & {
    typeParameters?: { end: number | null } | null;
    typeArguments?: { end: number | null } | null;
  };
  const anchor = typed.typeParameters?.end ?? typed.typeArguments?.end ?? opening.name.end;
  return anchor ?? null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
