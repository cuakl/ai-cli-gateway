export const MAX_IMAGE_EDGE = 1600;

export type AnnotTool = 'pen' | 'arrow' | 'rect' | 'text';

export interface Point {
  x: number;
  y: number;
}

export type AnnotShape =
  | { kind: 'pen'; points: Point[] }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'text'; at: Point; value: string };

export interface AnnotState {
  shapes: AnnotShape[];
  undone: AnnotShape[];
}

export function emptyAnnotState(): AnnotState {
  return { shapes: [], undone: [] };
}

export function pushShape(state: AnnotState, shape: AnnotShape): AnnotState {
  return { shapes: [...state.shapes, shape], undone: [] };
}

export function undoShape(state: AnnotState): AnnotState {
  if (state.shapes.length === 0) return state;
  const shapes = state.shapes.slice(0, -1);
  const undone = [...state.undone, state.shapes[state.shapes.length - 1]!];
  return { shapes, undone };
}

export function redoShape(state: AnnotState): AnnotState {
  if (state.undone.length === 0) return state;
  const next = state.undone[state.undone.length - 1]!;
  return { shapes: [...state.shapes, next], undone: state.undone.slice(0, -1) };
}

export function downscaleSize(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE,
): { width: number; height: number; scale: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: Math.round(w), height: Math.round(h), scale: 1 };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export function extendPen(shape: Extract<AnnotShape, { kind: 'pen' }>, point: Point): Extract<AnnotShape, { kind: 'pen' }> {
  const last = shape.points[shape.points.length - 1];
  if (last && last.x === point.x && last.y === point.y) return shape;
  return { kind: 'pen', points: [...shape.points, point] };
}
