export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementBoxes {
  border: { top: number; left: number; width: number; height: number };
  margin: BoxSides;
  padding: BoxSides;
}

export function readBoxModel(
  element: Element,
  rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
  styles: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): ElementBoxes {
  return {
    border: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    margin: sides(styles, 'margin'),
    padding: sides(styles, 'padding'),
  };
}

function sides(styles: Pick<CSSStyleDeclaration, 'getPropertyValue'>, kind: 'margin' | 'padding'): BoxSides {
  return {
    top: px(styles.getPropertyValue(`${kind}-top`)),
    right: px(styles.getPropertyValue(`${kind}-right`)),
    bottom: px(styles.getPropertyValue(`${kind}-bottom`)),
    left: px(styles.getPropertyValue(`${kind}-left`)),
  };
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
