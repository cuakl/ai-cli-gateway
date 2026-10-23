import { ELEMENT_TAG } from '../brand.js';
import { downscaleSize, MAX_IMAGE_EDGE } from '../inspector/annotate.js';
import { BADGE_LAYER_ID } from '../inspector/badges.js';
import {
  HIGHLIGHT_ID,
  HIGHLIGHT_LABEL_ID,
  MARGIN_BOX_ID,
  PADDING_BOX_ID,
} from '../inspector/picker.js';
import { REGION_LAYER_ID } from '../inspector/region.js';
import type { RegionRect } from '../inspector/region.js';

export type ScreenshotMode = 'element' | 'region' | 'viewport';

export class CaptureError extends Error {
  readonly reason: 'tainted' | 'failed';

  constructor(reason: 'tainted' | 'failed', message: string) {
    super(message);
    this.name = 'CaptureError';
    this.reason = reason;
  }
}

type HtmlToImage = typeof import('html-to-image');

let htmlToImage: HtmlToImage | null = null;

async function loadHtmlToImage(): Promise<HtmlToImage> {
  if (htmlToImage) return htmlToImage;
  htmlToImage = await import('html-to-image');
  return htmlToImage;
}

/**
 * Snapshot a DOM node as a PNG data URL.
 * Cross-origin images and tainted canvases reject; the caller shows a warning chip.
 */
export async function captureElement(element: Element): Promise<string | undefined> {
  try {
    return await captureElementOrThrow(element);
  } catch {
    return undefined;
  }
}

export async function captureElementOrThrow(element: Element): Promise<string> {
  if (!(element instanceof HTMLElement)) {
    throw new CaptureError('failed', 'That node cannot be captured');
  }
  const { toPng } = await loadHtmlToImage();
  try {
    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: 1,
      filter: (node) => !isDevtoolsNode(node),
    });
    if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
      throw new CaptureError('failed', 'Screenshot capture returned an empty image');
    }
    return await downscaleDataUrl(dataUrl);
  } catch (error) {
    throw toCaptureError(error);
  }
}

export async function captureViewport(): Promise<string> {
  const root = document.documentElement;
  const { toPng } = await loadHtmlToImage();
  try {
    const dataUrl = await toPng(root, {
      cacheBust: true,
      pixelRatio: 1,
      filter: (node) => !isDevtoolsNode(node),
    });
    const crop = await cropDataUrl(dataUrl, {
      left: window.scrollX || 0,
      top: window.scrollY || 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    return await downscaleDataUrl(crop);
  } catch (error) {
    throw toCaptureError(error);
  }
}

export async function captureRegion(rect: RegionRect): Promise<string> {
  const root = document.documentElement;
  const { toPng } = await loadHtmlToImage();
  try {
    const dataUrl = await toPng(root, {
      cacheBust: true,
      pixelRatio: 1,
      filter: (node) => !isDevtoolsNode(node),
    });
    const crop = await cropDataUrl(dataUrl, {
      left: (window.scrollX || 0) + rect.left,
      top: (window.scrollY || 0) + rect.top,
      width: rect.width,
      height: rect.height,
    });
    return await downscaleDataUrl(crop);
  } catch (error) {
    throw toCaptureError(error);
  }
}

export async function downscaleDataUrl(dataUrl: string, maxEdge = MAX_IMAGE_EDGE): Promise<string> {
  let image: HTMLImageElement;
  try {
    image = await loadImage(dataUrl);
  } catch {
    return dataUrl;
  }
  const next = downscaleSize(image.width, image.height, maxEdge);
  if (next.scale === 1) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = next.width;
  canvas.height = next.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0, next.width, next.height);
  try {
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw toCaptureError(error);
  }
}

export async function cropDataUrl(
  dataUrl: string,
  rect: { left: number; top: number; width: number; height: number },
): Promise<string> {
  const image = await loadImage(dataUrl);
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const width = Math.max(1, Math.min(Math.round(rect.width), image.width - left));
  const height = Math.max(1, Math.min(Math.round(rect.height), image.height - top));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CaptureError('failed', 'Could not crop the screenshot');
  ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
  try {
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw toCaptureError(error);
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (ok && image.naturalWidth > 0) resolve(image);
      else reject(new CaptureError('failed', 'Could not decode the screenshot'));
    };
    const timer = window.setTimeout(() => finish(false), 250);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = dataUrl;
    if (image.complete) finish(image.naturalWidth > 0);
  });
}

function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const tainted = /taint|insecure|cross-origin|CORS/i.test(message);
  return new CaptureError(tainted ? 'tainted' : 'failed', tainted ? 'Screenshot failed (tainted canvas)' : 'Screenshot capture failed');
}

function isDevtoolsNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (
    node.id === HIGHLIGHT_ID ||
    node.id === HIGHLIGHT_LABEL_ID ||
    node.id === MARGIN_BOX_ID ||
    node.id === PADDING_BOX_ID ||
    node.id === BADGE_LAYER_ID ||
    node.id === REGION_LAYER_ID
  ) {
    return true;
  }
  return node.tagName === ELEMENT_TAG.toUpperCase() || Boolean(node.closest(ELEMENT_TAG));
}
