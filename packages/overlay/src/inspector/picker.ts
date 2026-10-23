import { ELEMENT_TAG } from '../brand.js';
import { AID_FONT, AID_Z_HOST, DARK_PALETTE } from '../ui/theme/tokens.js';

export const HIGHLIGHT_ID = 'ai-devtools-highlight';

export interface HighlightFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ElementPickerOptions {
  onSelect: (element: Element) => void;
  onCancel?: () => void;
}

/** Viewport rect plus document scroll, for an absolutely positioned highlight. */
export function highlightFrame(
  rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
  scrollX: number,
  scrollY: number,
): HighlightFrame {
  return {
    top: rect.top + scrollY,
    left: rect.left + scrollX,
    width: rect.width,
    height: rect.height,
  };
}

/** `div#id.class (320x48)` */
export function describeElement(
  element: Element,
  rect: Pick<DOMRect, 'width' | 'height'>,
): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
  const classPart = classes.length > 0 ? `.${classes.join('.')}` : '';
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  return `${tag}${id}${classPart} (${width}x${height})`;
}

/**
 * Capture-phase hover highlight. Clicks are swallowed so the host page does
 * not follow links or run its own click handlers while a selection is armed.
 */
export class ElementPicker {
  private listening = false;
  private highlight: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private previousCursor = '';

  constructor(private readonly options: ElementPickerOptions) {}

  get active(): boolean {
    return this.listening;
  }

  start(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    this.previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
  }

  stop(): void {
    if (this.listening) {
      this.listening = false;
      window.removeEventListener('mousemove', this.onMove, true);
      window.removeEventListener('click', this.onClick, true);
      window.removeEventListener('keydown', this.onKey, true);
      document.documentElement.style.cursor = this.previousCursor;
    }
    this.removeHighlight();
  }

  private onMove = (event: MouseEvent): void => {
    if (!this.listening) return;
    const element = this.elementFromEvent(event);
    if (!element) {
      this.hideHighlight();
      return;
    }
    this.positionHighlight(element);
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.listening || event.button !== 0) return;
    const element = this.elementFromEvent(event);
    if (!element) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.stop();
    this.options.onSelect(element);
  };

  private onKey = (event: KeyboardEvent): void => {
    if (!this.listening || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.stop();
    this.options.onCancel?.();
  };

  private elementFromEvent(event: MouseEvent): Element | null {
    if (this.hitsOverlay(event)) return null;
    const fromPoint = document.elementFromPoint(event.clientX, event.clientY);
    const target = event.target instanceof Element ? event.target : null;
    const candidate = fromPoint && !isOverlayElement(fromPoint) ? fromPoint : target;
    if (!candidate || isOverlayElement(candidate)) return null;
    return candidate;
  }

  private hitsOverlay(event: Event): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.some((node) => isOverlayElement(node))) return true;
    return isOverlayElement(event.target);
  }

  private positionHighlight(element: Element): void {
    const box = this.ensureHighlight();
    const rect = element.getBoundingClientRect();
    const frame = highlightFrame(rect, windowScrollX(), windowScrollY());
    box.style.top = `${frame.top}px`;
    box.style.left = `${frame.left}px`;
    box.style.width = `${Math.max(frame.width, 0)}px`;
    box.style.height = `${Math.max(frame.height, 0)}px`;
    box.style.display = 'block';
    if (!box.isConnected && document.body) document.body.appendChild(box);
    if (this.label) {
      this.label.textContent = describeElement(element, rect);
      const above = frame.top > 28;
      this.label.style.top = above ? '0' : '4px';
      this.label.style.transform = above ? 'translateY(calc(-100% - 4px))' : 'none';
    }
  }

  private ensureHighlight(): HTMLDivElement {
    if (this.highlight) return this.highlight;
    const box = document.createElement('div');
    box.id = HIGHLIGHT_ID;
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      all: 'initial',
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      display: 'none',
      margin: '0',
      padding: '0',
      pointerEvents: 'none',
      zIndex: String(AID_Z_HOST - 1),
      boxSizing: 'border-box',
      background: 'rgba(124, 108, 255, 0.16)',
      outline: `2px solid ${DARK_PALETTE.accent}`,
      borderRadius: '6px',
      transition: 'top 60ms ease, left 60ms ease, width 60ms ease, height 60ms ease',
    });
    const label = document.createElement('div');
    Object.assign(label.style, {
      all: 'initial',
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'block',
      transform: 'translateY(calc(-100% - 4px))',
      padding: '3px 8px',
      borderRadius: '6px',
      background: DARK_PALETTE.bgRaised,
      color: DARK_PALETTE.text,
      fontFamily: AID_FONT,
      fontSize: '12px',
      lineHeight: '1.5',
      fontWeight: '560',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    box.appendChild(label);
    this.highlight = box;
    this.label = label;
    return box;
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = 'none';
  }

  private removeHighlight(): void {
    this.highlight?.remove();
    this.highlight = null;
    this.label = null;
  }
}

function windowScrollX(): number {
  return window.scrollX || window.pageXOffset || document.documentElement?.scrollLeft || 0;
}

function windowScrollY(): number {
  return window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0;
}

function isOverlayElement(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false;
  if (node.id === HIGHLIGHT_ID || node.closest(`#${HIGHLIGHT_ID}`)) return true;
  return node.tagName === ELEMENT_TAG.toUpperCase() || Boolean(node.closest(ELEMENT_TAG));
}
