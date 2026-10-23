import { describe, expect, it } from 'vitest';
import { formatHoverLabel, placeLabel } from '../src/inspector/label.js';

describe('formatHoverLabel', () => {
  it('puts the component and file on line 1 and tag size on line 2', () => {
    expect(
      formatHoverLabel({
        componentName: 'ProductCard',
        fileName: 'src/components/CardGrid.tsx',
        lineNumber: 30,
        tagName: 'STRONG',
        width: 42.4,
        height: 18.6,
      }),
    ).toEqual({
      title: 'ProductCard · CardGrid.tsx:30',
      subtitle: 'strong 42×19',
    });
  });

  it('falls back to the tag when there is no source file', () => {
    expect(formatHoverLabel({ tagName: 'BUTTON', width: 130, height: 44 })).toEqual({
      title: 'button',
      subtitle: 'button 130×44',
    });
  });
});

describe('placeLabel', () => {
  const label = { width: 180, height: 32 };

  it('flips above the target when there is room', () => {
    expect(placeLabel({ top: 80, left: 40, width: 100, height: 20 }, label, { width: 800, height: 600 })).toEqual({
      top: 42,
      left: 40,
    });
  });

  it('flips below when the target is against the top edge', () => {
    expect(placeLabel({ top: 4, left: 10, width: 80, height: 20 }, label, { width: 800, height: 600 })).toEqual({
      top: 30,
      left: 10,
    });
  });

  it('shifts left to stay in the viewport', () => {
    const placed = placeLabel({ top: 200, left: 700, width: 90, height: 20 }, label, { width: 800, height: 600 });
    expect(placed.left + label.width).toBeLessThanOrEqual(800);
    expect(placed.top).toBe(162);
  });
});
