export const LABEL_GAP = 6;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface HoverLabelText {
  /** `ComponentName · File.tsx:11` */
  title: string;
  /** `button 130×44` */
  subtitle: string;
}

export function formatHoverLabel(input: {
  componentName?: string;
  fileName?: string;
  lineNumber?: number;
  tagName: string;
  width: number;
  height: number;
}): HoverLabelText {
  const tag = input.tagName.toLowerCase();
  const subtitle = `${tag} ${Math.round(input.width)}×${Math.round(input.height)}`;
  if (!input.fileName) return { title: tag, subtitle };
  const file = input.fileName.split(/[/\\]/).pop() ?? input.fileName;
  const name = input.componentName?.trim() || stemFromFile(file);
  const line = input.lineNumber ?? 0;
  return { title: `${name} · ${file}:${line}`, subtitle };
}

/**
 * Place a label around `target` with `gap` px clearance. Prefers above, then
 * below; slides horizontally to stay in the viewport without covering the box.
 */
export function placeLabel(
  target: Rect,
  label: Size,
  viewport: Size,
  gap = LABEL_GAP,
): { top: number; left: number } {
  const labelWidth = Math.max(label.width, 1);
  const labelHeight = Math.max(label.height, 1);
  const spaceAbove = target.top;
  const spaceBelow = viewport.height - (target.top + target.height);
  const need = labelHeight + gap;

  let top: number;
  if (spaceAbove >= need) {
    top = target.top - gap - labelHeight;
  } else if (spaceBelow >= need) {
    top = target.top + target.height + gap;
  } else if (spaceAbove >= spaceBelow) {
    top = Math.max(0, target.top - gap - labelHeight);
  } else {
    top = Math.min(viewport.height - labelHeight, target.top + target.height + gap);
  }
  top = clamp(top, 0, Math.max(0, viewport.height - labelHeight));

  let left = target.left;
  if (left + labelWidth > viewport.width) left = viewport.width - labelWidth;
  if (left < 0) left = 0;

  const overlap = rectsOverlap(
    { top, left, width: labelWidth, height: labelHeight },
    target,
  );
  if (overlap) {
    if (spaceBelow >= spaceAbove && target.top + target.height + gap + labelHeight <= viewport.height) {
      top = target.top + target.height + gap;
    } else if (target.top - gap - labelHeight >= 0) {
      top = target.top - gap - labelHeight;
    }
    top = clamp(top, 0, Math.max(0, viewport.height - labelHeight));
  }

  return { top, left };
}

function stemFromFile(file: string): string {
  return file.replace(/\.[^.]+$/, '') || file;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}
