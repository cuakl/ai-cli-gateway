import { describe, expect, it } from 'vitest';
import {
  downscaleSize,
  emptyAnnotState,
  MAX_IMAGE_EDGE,
  pushShape,
  redoShape,
  undoShape,
} from '../src/inspector/annotate.js';

describe('annotation undo stack', () => {
  it('pushes shapes and undoes the last one', () => {
    let state = emptyAnnotState();
    state = pushShape(state, { kind: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    state = pushShape(state, { kind: 'arrow', from: { x: 1, y: 1 }, to: { x: 8, y: 8 } });
    expect(state.shapes).toHaveLength(2);
    state = undoShape(state);
    expect(state.shapes).toHaveLength(1);
    expect(state.shapes[0]?.kind).toBe('rect');
    state = redoShape(state);
    expect(state.shapes[1]?.kind).toBe('arrow');
    state = pushShape(state, { kind: 'text', at: { x: 2, y: 2 }, value: 'hi' });
    expect(state.undone).toEqual([]);
  });
});

describe('downscale math', () => {
  it('leaves images within the long-edge budget alone', () => {
    expect(downscaleSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it('scales so the long edge is 1600', () => {
    expect(downscaleSize(3200, 1800)).toEqual({ width: 1600, height: 900, scale: 0.5 });
    expect(downscaleSize(1200, 4800).height).toBe(MAX_IMAGE_EDGE);
    expect(downscaleSize(1200, 4800).width).toBe(400);
  });
});
