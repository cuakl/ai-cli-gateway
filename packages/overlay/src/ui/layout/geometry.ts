export const PILL_HEIGHT = 40;
export const PILL_INSET = 16;
export const SIDE_MIN = 340;
export const SIDE_MAX = 900;
export const SIDE_CHAT_DEFAULT = 420;
export const BOTTOM_MIN = 160;
export const BOTTOM_DEFAULT = 300;
export const BOTTOM_MAX_VH = 0.7;
export const REVIEW_FLOOR = 640;
export const COMPACT_BELOW = 640;
export const SHEET_BELOW = 768;
export const RESIZE_STEP = 16;

export type PillCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type SideTab = 'chat' | 'diffs';
export type BottomTab = 'terminal' | 'tests' | 'console';
export type DockMode = 'push' | 'overlay';

export function parseDockMode(value: unknown): DockMode | undefined {
  if (value === 'push' || value === 'overlay') return value;
  return undefined;
}

export function isCompactViewport(width: number): boolean {
  return width < COMPACT_BELOW;
}

export function isSheetViewport(width: number): boolean {
  return width < SHEET_BELOW;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampSideWidth(width: number): number {
  return clamp(Math.round(width), SIDE_MIN, SIDE_MAX);
}

export function bottomMaxHeight(viewportHeight: number): number {
  return Math.max(BOTTOM_MIN, Math.round(viewportHeight * BOTTOM_MAX_VH));
}

export function clampBottomHeight(height: number, viewportHeight: number): number {
  return clamp(Math.round(height), BOTTOM_MIN, bottomMaxHeight(viewportHeight));
}

export function reviewDefaultWidth(viewportWidth: number): number {
  return clampSideWidth(Math.max(REVIEW_FLOOR, Math.round(viewportWidth * 0.5)));
}

export function defaultSideWidth(tab: SideTab, viewportWidth: number): number {
  return tab === 'diffs' ? reviewDefaultWidth(viewportWidth) : clampSideWidth(SIDE_CHAT_DEFAULT);
}

export function snapCorner(x: number, y: number, viewportWidth: number, viewportHeight: number): PillCorner {
  const vertical = y < viewportHeight / 2 ? 'top' : 'bottom';
  const horizontal = x < viewportWidth / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}`;
}

export function shouldPush(mode: DockMode, sheet: boolean): boolean {
  return mode === 'push' && !sheet;
}

export function readViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function pillOffset(
  corner: PillCorner,
  sideOpen: boolean,
  bottomOpen: boolean,
  sideWidth: number,
  bottomHeight: number,
  sheet: boolean,
): { inline: number; block: number } {
  const inlineDock = !sheet && sideOpen && corner.endsWith('right') ? sideWidth : 0;
  const blockDock = !sheet && bottomOpen && corner.startsWith('bottom') ? bottomHeight : 0;
  return { inline: PILL_INSET + inlineDock, block: PILL_INSET + blockDock };
}
