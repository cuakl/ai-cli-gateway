import { toPng } from 'html-to-image';
import { HIGHLIGHT_ID } from '../inspector/picker.js';

/**
 * Snapshot a DOM node as a PNG data URL.
 * Cross-origin images and tainted canvases reject; the caller treats that as "no screenshot".
 */
export async function captureElement(element: Element): Promise<string | undefined> {
  if (!(element instanceof HTMLElement)) return undefined;
  try {
    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: 1,
      filter: (node) => !isDevtoolsNode(node),
    });
    if (typeof dataUrl !== 'string' || dataUrl.length === 0) return undefined;
    return dataUrl;
  } catch {
    return undefined;
  }
}

function isDevtoolsNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.tagName === 'AI-DEVTOOLS' || node.id === HIGHLIGHT_ID;
}
