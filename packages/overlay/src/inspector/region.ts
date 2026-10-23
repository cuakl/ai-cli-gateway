import { ELEMENT_TAG } from '../brand.js';
import { AID_Z_HOST, DARK_PALETTE } from '../ui/theme/tokens.js';
import { HIGHLIGHT_ID, HIGHLIGHT_LABEL_ID } from './picker.js';
import { BADGE_LAYER_ID } from './badges.js';

export const REGION_LAYER_ID = 'ai-devtools-region-layer';

export interface RegionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RegionPickerOptions {
  onSelect: (rect: RegionRect) => void;
  onCancel?: () => void;
}

/** Drag a viewport rectangle; used for region screenshots. */
export class RegionPicker {
  private listening = false;
  private layer: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private origin: { x: number; y: number } | null = null;
  private previousCursor = '';

  constructor(private readonly options: RegionPickerOptions) {}

  get active(): boolean {
    return this.listening;
  }

  start(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    const layer = this.ensureLayer();
    document.body?.appendChild(layer);
    window.addEventListener('mousedown', this.onDown, true);
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('mouseup', this.onUp, true);
    window.addEventListener('keydown', this.onKey, true);
    this.previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
  }

  stop(): void {
    if (this.listening) {
      this.listening = false;
      window.removeEventListener('mousedown', this.onDown, true);
      window.removeEventListener('mousemove', this.onMove, true);
      window.removeEventListener('mouseup', this.onUp, true);
      window.removeEventListener('keydown', this.onKey, true);
      document.documentElement.style.cursor = this.previousCursor;
    }
    this.origin = null;
    this.layer?.remove();
    this.layer = null;
    this.box = null;
  }

  private onDown = (event: MouseEvent): void => {
    if (!this.listening || event.button !== 0) return;
    if (this.hitsOverlay(event)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.origin = { x: event.clientX, y: event.clientY };
    this.updateBox(event.clientX, event.clientY);
  };

  private onMove = (event: MouseEvent): void => {
    if (!this.listening || !this.origin) return;
    this.updateBox(event.clientX, event.clientY);
  };

  private onUp = (event: MouseEvent): void => {
    if (!this.listening || !this.origin) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const rect = normalize(this.origin, event.clientX, event.clientY);
    this.stop();
    if (rect.width < 4 || rect.height < 4) {
      this.options.onCancel?.();
      return;
    }
    this.options.onSelect(rect);
  };

  private onKey = (event: KeyboardEvent): void => {
    if (!this.listening || event.key !== 'Escape') return;
    event.preventDefault();
    this.stop();
    this.options.onCancel?.();
  };

  private updateBox(x: number, y: number): void {
    if (!this.origin || !this.box) return;
    const rect = normalize(this.origin, x, y);
    this.box.style.display = 'block';
    this.box.style.left = `${rect.left}px`;
    this.box.style.top = `${rect.top}px`;
    this.box.style.width = `${rect.width}px`;
    this.box.style.height = `${rect.height}px`;
  }

  private ensureLayer(): HTMLDivElement {
    if (this.layer) return this.layer;
    const layer = document.createElement('div');
    layer.id = REGION_LAYER_ID;
    Object.assign(layer.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: String(AID_Z_HOST - 1),
      cursor: 'crosshair',
      pointerEvents: 'none',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      all: 'initial',
      position: 'fixed',
      display: 'none',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      border: `1px dashed ${DARK_PALETTE.accent}`,
      background: 'rgba(124, 108, 255, 0.12)',
    });
    layer.appendChild(box);
    this.layer = layer;
    this.box = box;
    return layer;
  }

  private hitsOverlay(event: Event): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.some((node) => node instanceof Element && isOverlayChrome(node));
  }
}

function normalize(origin: { x: number; y: number }, x: number, y: number): RegionRect {
  const left = Math.min(origin.x, x);
  const top = Math.min(origin.y, y);
  return { left, top, width: Math.abs(x - origin.x), height: Math.abs(y - origin.y) };
}

function isOverlayChrome(node: Element): boolean {
  if (
    node.id === HIGHLIGHT_ID ||
    node.id === HIGHLIGHT_LABEL_ID ||
    node.id === BADGE_LAYER_ID ||
    node.id === REGION_LAYER_ID
  ) {
    return true;
  }
  return node.tagName === ELEMENT_TAG.toUpperCase() || Boolean(node.closest(ELEMENT_TAG));
}
