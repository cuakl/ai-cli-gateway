import { escapeAttr, filePathFromId, shouldStampFile, toProjectPath } from './loc-path.js';

/** `@vue/compiler-core` `NodeTypes.ELEMENT`. */
const ELEMENT = 1;
/** `@vue/compiler-core` `ElementTypes.ELEMENT` (native tags, not components). */
const ELEMENT_TAG = 0;
/** `@vue/compiler-core` `NodeTypes.ATTRIBUTE`. */
const ATTRIBUTE = 6;
/** `@vue/compiler-core` `NodeTypes.TEXT`. */
const TEXT = 2;

export interface VueDataLocOptions {
  /** Project root for relative `data-loc` paths. Defaults to `process.cwd()`. */
  root?: string;
  /** When false, the transform is a no-op. Defaults to true. */
  injectDataLoc?: boolean;
}

export interface VueSourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface VueSourceLocation {
  start: VueSourcePosition;
  end: VueSourcePosition;
  source: string;
}

export interface VueTemplateNode {
  type: number;
  tag?: string;
  tagType?: number;
  props?: VueTemplateProp[];
  loc?: VueSourceLocation;
}

export interface VueTemplateProp {
  type: number;
  name?: string;
}

export interface VueTransformContext {
  filename?: string;
}

/**
 * Vue template `compilerOptions.nodeTransforms` callback.
 * Mutates element nodes in place; the compiler owns the object shape.
 */
export type VueNodeTransform = (node: VueTemplateNode, context: VueTransformContext) => void;

/**
 * Stamp `data-loc="relative/path.vue:line:col"` onto native Vue template
 * elements. Components, slots, and `<template>` are left alone.
 * Line and column are the Vue compiler's 1-based `loc.start`.
 */
export function createVueDataLocTransform(options: VueDataLocOptions = {}): VueNodeTransform {
  const root = options.root ?? process.cwd();
  if (options.injectDataLoc === false) return () => undefined;

  return (node, context) => {
    if (node.type !== ELEMENT || node.tagType !== ELEMENT_TAG) return;
    if (hasExplicitDataLoc(node)) return;
    const filename = context.filename ? filePathFromId(context.filename) : '';
    if (!filename || !shouldStampFile(filename)) return;
    const loc = node.loc;
    if (!loc) return;
    const relativePath = toProjectPath(filename, root);
    const value = escapeAttr(`${relativePath}:${loc.start.line}:${loc.start.column}`);
    const props = node.props ?? (node.props = []);
    props.push({
      type: ATTRIBUTE,
      name: 'data-loc',
      nameLoc: loc,
      value: {
        type: TEXT,
        content: value,
        loc,
      },
      loc,
    } as VueTemplateProp);
  };
}

function hasExplicitDataLoc(node: VueTemplateNode): boolean {
  return (node.props ?? []).some((prop) => prop.type === ATTRIBUTE && prop.name === 'data-loc');
}
