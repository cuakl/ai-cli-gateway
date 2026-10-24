import { ELEMENT_TAG } from '../brand.js';
import { AID_FONT, AID_Z_HOST, DARK_PALETTE } from '../ui/theme/tokens.js';
import { HIGHLIGHT_ID, HIGHLIGHT_LABEL_ID } from './picker.js';

export const BADGE_LAYER_ID = 'ai-devtools-selection-badges';

/**
 * Numbered badges on selected elements. Positions update on scroll/resize, rAF.
 */
export class SelectionBadges {
  private layer: HTMLDivElement | null = null;
  private elements: Element[] = [];
  private raf = 0;
  private listening = false;

  set(elements: readonly Element[]): void {
    this.elements = elements.filter((node) => node.isConnected);
    if (this.elements.length === 0) {
      this.hide();
      this.unlisten();
      return;
    }
    this.listen();
    this.schedule();
  }

  stop(): void {
    this.elements = [];
    this.unlisten();
    this.hide();
  }

  private listen(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('scroll', this.onChange, true);
    window.addEventListener('resize', this.onChange);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('scroll', this.onChange, true);
    window.removeEventListener('resize', this.onChange);
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private onChange = (): void => {
    this.schedule();
  };

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const layer = this.ensureLayer();
    const live = this.elements.filter((node) => node.isConnected && !isOverlayElement(node));
    this.elements = live;
    while (layer.childNodes.length > live.length) layer.lastChild?.remove();
    live.forEach((element, index) => {
      let badge = layer.childNodes[index] as HTMLDivElement | undefined;
      if (!badge) {
        badge = document.createElement('div');
        Object.assign(badge.style, badgeStyle());
        layer.appendChild(badge);
      }
      const rect = element.getBoundingClientRect();
      badge.textContent = String(index + 1);
      const size = 18;
      const offset = 10;
      const top = clamp(rect.top - offset, 0, window.innerHeight - size);
      const left = clamp(rect.left - offset, 0, window.innerWidth - size);
      badge.style.top = `${top}px`;
      badge.style.left = `${left}px`;
    });
    layer.style.display = live.length > 0 ? 'block' : 'none';
  }

  private ensureLayer(): HTMLDivElement {
    if (this.layer?.isConnected) return this.layer;
    const layer = document.createElement('div');
    layer.id = BADGE_LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: String(AID_Z_HOST - 1),
    });
    document.body?.appendChild(layer);
    this.layer = layer;
    return layer;
  }

  private hide(): void {
    this.layer?.remove();
    this.layer = null;
  }
}

function badgeStyle(): Record<string, string> {
  return {
    all: 'initial',
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '999px',
    background: DARK_PALETTE.accent,
    color: DARK_PALETTE.accentFg,
    fontFamily: AID_FONT,
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '18px',
    textAlign: 'center',
    pointerEvents: 'none',
    boxShadow: '0 0 0 1px rgba(255,255,255,.75), 0 1px 4px rgba(0,0,0,.35)',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function isOverlayElement(node: Element): boolean {
  if (node.id === HIGHLIGHT_ID || node.id === HIGHLIGHT_LABEL_ID || node.id === BADGE_LAYER_ID) return true;
  return node.tagName === ELEMENT_TAG.toUpperCase() || Boolean(node.closest(ELEMENT_TAG));
}
