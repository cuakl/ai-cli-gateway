import { ELEMENT_TAG } from '../brand.js';
import { AID_FONT, AID_Z_HOST, DARK_PALETTE } from '../ui/theme/tokens.js';
import { readBoxModel } from './box-model.js';
import { formatHoverLabel, placeLabel, type HoverLabelText } from './label.js';
import { resolveSourceLocation } from './locator.js';
import { locAncestors, pickHoverTarget, walkDown, walkUp } from './walk.js';

export const HIGHLIGHT_ID = 'ai-devtools-highlight';
export const HIGHLIGHT_LABEL_ID = 'ai-devtools-highlight-label';
export const MARGIN_BOX_ID = 'ai-devtools-margin-box';
export const PADDING_BOX_ID = 'ai-devtools-padding-box';

const MARGIN_FILL = 'rgba(246, 178, 107, 0.45)';
const PADDING_FILL = 'rgba(147, 196, 125, 0.45)';

export interface HighlightFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ElementPickerOptions {
  onSelect: (element: Element, extras: { shift: boolean }) => void;
  onCancel?: () => void;
  onOpenEditor?: (element: Element) => void;
}

interface CachedLabel {
  title: string;
  tag: string;
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
  private titleNode: HTMLDivElement | null = null;
  private subtitleNode: HTMLDivElement | null = null;
  private marginBox: HTMLDivElement | null = null;
  private paddingBox: HTMLDivElement | null = null;
  private previousCursor = '';
  private raf = 0;
  private pending: Element | null = null;
  private hovered: Element | null = null;
  private path: Element[] = [];
  private pathIndex = 0;
  private leaf: Element | null = null;
  private altHeld = false;
  private readonly cache = new WeakMap<Element, CachedLabel>();

  constructor(private readonly options: ElementPickerOptions) {}

  get active(): boolean {
    return this.listening;
  }

  get hoveredElement(): Element | null {
    return this.hovered;
  }

  start(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
  }

  stop(): void {
    if (this.listening) {
      this.listening = false;
      window.removeEventListener('mousemove', this.onMove, true);
      window.removeEventListener('click', this.onClick, true);
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      document.documentElement.style.cursor = this.previousCursor;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.pending = null;
    this.hovered = null;
    this.path = [];
    this.pathIndex = 0;
    this.leaf = null;
    this.removeHighlight();
  }

  private onMove = (event: MouseEvent): void => {
    if (!this.listening) return;
    this.altHeld = event.altKey;
    const element = this.elementFromEvent(event);
    this.pending = element;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.applyPending();
    });
  };

  private applyPending(): void {
    if (!this.listening) return;
    const element = this.pending;
    if (!element) {
      this.hideHighlight();
      this.hovered = null;
      return;
    }
    const leaf = pickHoverTarget(element);
    if (leaf !== this.leaf) {
      this.leaf = leaf;
      this.path = locAncestors(leaf).slice().reverse();
      if (this.path.length === 0) this.path = [leaf];
      this.pathIndex = this.path.length - 1;
    }
    const current = this.path[this.pathIndex] ?? leaf;
    this.hovered = current;
    this.positionHighlight(current);
  }

  private onClick = (event: MouseEvent): void => {
    if (!this.listening || event.button !== 0) return;
    if (this.hitsOverlay(event)) return;
    const element = this.hovered ?? this.elementFromEvent(event);
    if (!element) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.altKey) {
      this.options.onOpenEditor?.(element);
      return;
    }
    if (event.shiftKey) {
      this.options.onSelect(element, { shift: true });
      return;
    }
    this.stop();
    this.options.onSelect(element, { shift: false });
  };

  private onKey = (event: KeyboardEvent): void => {
    if (!this.listening) return;
    if (event.key === 'Alt') {
      this.altHeld = true;
      if (this.hovered) this.positionHighlight(this.hovered);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'Up') {
      event.preventDefault();
      event.stopPropagation();
      this.pathIndex = walkUp(this.path, this.pathIndex);
      const current = this.path[this.pathIndex];
      if (current) {
        this.hovered = current;
        this.positionHighlight(current);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'Down') {
      event.preventDefault();
      event.stopPropagation();
      this.pathIndex = walkDown(this.path, this.pathIndex);
      const current = this.path[this.pathIndex];
      if (current) {
        this.hovered = current;
        this.positionHighlight(current);
      }
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.stop();
    this.options.onCancel?.();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.listening) return;
    if (event.key !== 'Alt') return;
    this.altHeld = false;
    if (this.hovered) this.positionHighlight(this.hovered);
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
    this.renderLabel(element, rect);
    this.renderBoxModel(element, rect, frame);
  }

  private renderLabel(element: Element, rect: DOMRect): void {
    if (!this.label || !this.titleNode || !this.subtitleNode) return;
    this.label.style.display = 'block';
    const text = this.labelText(element, rect);
    this.titleNode.textContent = text.title;
    this.subtitleNode.textContent = text.subtitle;
    const measured = this.label.getBoundingClientRect();
    const size = {
      width: measured.width || estimateLabelWidth(text),
      height: measured.height || 36,
    };
    const placed = placeLabel(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      size,
      { width: window.innerWidth || 1024, height: window.innerHeight || 768 },
    );
    this.label.style.position = 'fixed';
    this.label.style.top = `${placed.top}px`;
    this.label.style.left = `${placed.left}px`;
    this.label.style.transform = 'none';
  }

  private labelText(element: Element, rect: Pick<DOMRect, 'width' | 'height'>): HoverLabelText {
    let cached = this.cache.get(element);
    if (!cached) {
      const source = resolveSourceLocation(element);
      const formatted = formatHoverLabel({
        tagName: element.tagName,
        width: rect.width,
        height: rect.height,
        ...(source?.componentName ? { componentName: source.componentName } : {}),
        ...(source?.fileName ? { fileName: source.fileName, lineNumber: source.lineNumber } : {}),
      });
      cached = { title: formatted.title, tag: element.tagName.toLowerCase() };
      this.cache.set(element, cached);
    }
    return {
      title: cached.title,
      subtitle: `${cached.tag} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
    };
  }

  private renderBoxModel(element: Element, rect: DOMRect, frame: HighlightFrame): void {
    const margin = this.ensureMargin();
    const padding = this.ensurePadding();
    if (!this.altHeld) {
      margin.style.display = 'none';
      padding.style.display = 'none';
      return;
    }
    const styles = (element.ownerDocument?.defaultView ?? window).getComputedStyle(element);
    const boxes = readBoxModel(element, rect, styles);
    margin.style.display = 'block';
    margin.style.top = `${frame.top - boxes.margin.top}px`;
    margin.style.left = `${frame.left - boxes.margin.left}px`;
    margin.style.width = `${Math.max(frame.width + boxes.margin.left + boxes.margin.right, 0)}px`;
    margin.style.height = `${Math.max(frame.height + boxes.margin.top + boxes.margin.bottom, 0)}px`;
    padding.style.display = 'block';
    padding.style.top = `${frame.top}px`;
    padding.style.left = `${frame.left}px`;
    padding.style.width = `${Math.max(frame.width, 0)}px`;
    padding.style.height = `${Math.max(frame.height, 0)}px`;
    padding.style.borderTopWidth = `${boxes.padding.top}px`;
    padding.style.borderRightWidth = `${boxes.padding.right}px`;
    padding.style.borderBottomWidth = `${boxes.padding.bottom}px`;
    padding.style.borderLeftWidth = `${boxes.padding.left}px`;
    if (!margin.isConnected && document.body) document.body.appendChild(margin);
    if (!padding.isConnected && document.body) document.body.appendChild(padding);
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
    label.id = HIGHLIGHT_LABEL_ID;
    Object.assign(label.style, {
      all: 'initial',
      position: 'fixed',
      left: '0',
      top: '0',
      display: 'block',
      padding: '3px 8px',
      borderRadius: '6px',
      background: DARK_PALETTE.bgRaised,
      color: DARK_PALETTE.text,
      fontFamily: AID_FONT,
      fontSize: '12px',
      lineHeight: '1.35',
      fontWeight: '560',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: String(AID_Z_HOST - 1),
      boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    });
    const title = document.createElement('div');
    Object.assign(title.style, {
      all: 'initial',
      display: 'block',
      color: DARK_PALETTE.text,
      fontFamily: AID_FONT,
      fontSize: '12px',
      fontWeight: '560',
      lineHeight: '1.35',
      whiteSpace: 'nowrap',
    });
    const subtitle = document.createElement('div');
    Object.assign(subtitle.style, {
      all: 'initial',
      display: 'block',
      color: DARK_PALETTE.textMuted,
      fontFamily: AID_FONT,
      fontSize: '12px',
      fontWeight: '500',
      lineHeight: '1.35',
      whiteSpace: 'nowrap',
    });
    label.appendChild(title);
    label.appendChild(subtitle);
    document.body?.appendChild(label);
    this.highlight = box;
    this.label = label;
    this.titleNode = title;
    this.subtitleNode = subtitle;
    return box;
  }

  private ensureMargin(): HTMLDivElement {
    if (this.marginBox) return this.marginBox;
    const box = document.createElement('div');
    box.id = MARGIN_BOX_ID;
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      all: 'initial',
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      zIndex: String(AID_Z_HOST - 2),
      boxSizing: 'border-box',
      background: MARGIN_FILL,
    });
    this.marginBox = box;
    return box;
  }

  private ensurePadding(): HTMLDivElement {
    if (this.paddingBox) return this.paddingBox;
    const box = document.createElement('div');
    box.id = PADDING_BOX_ID;
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      all: 'initial',
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      zIndex: String(AID_Z_HOST - 1),
      boxSizing: 'border-box',
      borderStyle: 'solid',
      borderColor: PADDING_FILL,
      background: 'transparent',
    });
    this.paddingBox = box;
    return box;
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = 'none';
    if (this.label) this.label.style.display = 'none';
    if (this.marginBox) this.marginBox.style.display = 'none';
    if (this.paddingBox) this.paddingBox.style.display = 'none';
  }

  private removeHighlight(): void {
    this.highlight?.remove();
    this.label?.remove();
    this.marginBox?.remove();
    this.paddingBox?.remove();
    this.highlight = null;
    this.label = null;
    this.titleNode = null;
    this.subtitleNode = null;
    this.marginBox = null;
    this.paddingBox = null;
  }
}

function estimateLabelWidth(text: HoverLabelText): number {
  return Math.max(text.title.length, text.subtitle.length) * 7.2 + 16;
}

function windowScrollX(): number {
  return window.scrollX || window.pageXOffset || document.documentElement?.scrollLeft || 0;
}

function windowScrollY(): number {
  return window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0;
}

function isOverlayElement(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false;
  if (
    node.id === HIGHLIGHT_ID ||
    node.id === HIGHLIGHT_LABEL_ID ||
    node.id === MARGIN_BOX_ID ||
    node.id === PADDING_BOX_ID ||
    node.closest(`#${HIGHLIGHT_ID}`)
  ) {
    return true;
  }
  return node.tagName === ELEMENT_TAG.toUpperCase() || Boolean(node.closest(ELEMENT_TAG));
}
