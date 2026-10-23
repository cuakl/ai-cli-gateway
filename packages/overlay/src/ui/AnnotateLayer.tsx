import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  emptyAnnotState,
  extendPen,
  pushShape,
  undoShape,
  type AnnotShape,
  type AnnotState,
  type AnnotTool,
  type Point,
} from '../inspector/annotate.js';
import { DARK_PALETTE } from './theme/tokens.js';
import { MoveUpRightIcon, PencilIcon, SquareIcon, TypeIcon, Undo2Icon, XIcon } from './icons.js';

export interface AnnotateLayerProps {
  dataUrl: string;
  onAttach: (dataUrl: string) => void;
  onCancel: () => void;
}

const ACCENT = DARK_PALETTE.accent;
const STROKE = 2.5;

export function AnnotateLayer({ dataUrl, onAttach, onCancel }: AnnotateLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotTool>('pen');
  const [state, setState] = useState<AnnotState>(emptyAnnotState);
  const [draftText, setDraftText] = useState<{ at: Point; value: string } | null>(null);
  const drag = useRef<{ tool: AnnotTool; start: Point; shape?: AnnotShape } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.width;
      canvas.height = image.height;
      paint(canvas, image, state.shapes);
    };
    image.src = dataUrl;
  }, [dataUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    paint(canvas, image, state.shapes);
  }, [state]);

  function pointFromEvent(event: MouseEvent): Point | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: event.offsetX, y: event.offsetY };
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  function onPointerDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    const current = toolRef.current;
    if (current === 'text') {
      setDraftText({ at: point, value: '' });
      return;
    }
    if (current === 'pen') {
      const shape: AnnotShape = { kind: 'pen', points: [point] };
      drag.current = { tool: current, start: point, shape };
      setState((prev) => pushShape(prev, shape));
      return;
    }
    drag.current = { tool: current, start: point };
  }

  function onPointerMove(event: MouseEvent): void {
    const current = drag.current;
    const point = pointFromEvent(event);
    if (!current || !point) return;
    if (current.tool === 'pen' && current.shape?.kind === 'pen') {
      const next = extendPen(current.shape, point);
      current.shape = next;
      setState((prev) => {
        if (prev.shapes.length === 0) return prev;
        return { ...prev, shapes: [...prev.shapes.slice(0, -1), next] };
      });
      return;
    }
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const preview: AnnotShape =
      current.tool === 'arrow'
        ? { kind: 'arrow', from: current.start, to: point }
        : { kind: 'rect', from: current.start, to: point };
    paint(canvas, image, [...state.shapes, preview]);
  }

  function onPointerUp(event: MouseEvent): void {
    const current = drag.current;
    drag.current = null;
    if (!current || current.tool === 'pen' || current.tool === 'text') return;
    const point = pointFromEvent(event);
    if (!point) return;
    const shape: AnnotShape =
      current.tool === 'arrow'
        ? { kind: 'arrow', from: current.start, to: point }
        : { kind: 'rect', from: current.start, to: point };
    setState((prev) => pushShape(prev, shape));
  }

  function commitText(): void {
    if (!draftText || draftText.value.trim().length === 0) {
      setDraftText(null);
      return;
    }
    setState((prev) => pushShape(prev, { kind: 'text', at: draftText.at, value: draftText.value.trim() }));
    setDraftText(null);
  }

  function attach(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      onAttach(canvas.toDataURL('image/png'));
    } catch {
      onCancel();
    }
  }

  return (
    <div className="annotate-backdrop" role="dialog" aria-label="Annotate screenshot" data-action="annotate-layer">
      <div className="annotate-modal">
        <div className="annotate-toolbar">
          <ToolButton action="annotate-pen" label="Pen" pressed={tool === 'pen'} onClick={() => setTool('pen')}>
            <PencilIcon size={14} />
          </ToolButton>
          <ToolButton action="annotate-arrow" label="Arrow" pressed={tool === 'arrow'} onClick={() => setTool('arrow')}>
            <MoveUpRightIcon size={14} />
          </ToolButton>
          <ToolButton action="annotate-rect" label="Rectangle" pressed={tool === 'rect'} onClick={() => setTool('rect')}>
            <SquareIcon size={14} />
          </ToolButton>
          <ToolButton action="annotate-text" label="Text" pressed={tool === 'text'} onClick={() => setTool('text')}>
            <TypeIcon size={14} />
          </ToolButton>
          <ToolButton
            action="annotate-undo"
            label="Undo"
            onClick={() => setState((prev) => undoShape(prev))}
          >
            <Undo2Icon size={14} />
          </ToolButton>
          <span className="annotate-spacer" />
          <button type="button" className="ghost" data-action="annotate-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" data-action="annotate-attach" onClick={attach}>
            Attach
          </button>
          <button
            type="button"
            className="icon-button"
            data-action="annotate-close"
            aria-label="Cancel annotation"
            title="Cancel"
            onClick={onCancel}
          >
            <XIcon />
          </button>
        </div>
        <div className="annotate-stage">
          <canvas
            ref={canvasRef}
            className="annotate-canvas"
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
          />
          {draftText ? (
            <input
              className="annotate-text-input"
              style={{ left: draftText.at.x, top: draftText.at.y }}
              value={draftText.value}
              autoFocus
              aria-label="Annotation text"
              onInput={(event) => setDraftText({ ...draftText, value: event.currentTarget.value })}
              onBlur={commitText}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitText();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraftText(null);
                }
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  action,
  label,
  pressed,
  onClick,
  children,
}: {
  action: string;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <button
      type="button"
      className="icon-button"
      data-action={action}
      aria-label={label}
      title={label}
      aria-pressed={pressed ? 'true' : 'false'}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, shapes: readonly AnnotShape[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = '16px ui-sans-serif, system-ui, sans-serif';
  for (const shape of shapes) drawShape(ctx, shape);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: AnnotShape): void {
  if (shape.kind === 'pen') {
    if (shape.points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(shape.points[0]!.x, shape.points[0]!.y);
    for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    return;
  }
  if (shape.kind === 'rect') {
    const x = Math.min(shape.from.x, shape.to.x);
    const y = Math.min(shape.from.y, shape.to.y);
    ctx.strokeRect(x, y, Math.abs(shape.to.x - shape.from.x), Math.abs(shape.to.y - shape.from.y));
    return;
  }
  if (shape.kind === 'text') {
    ctx.fillText(shape.value, shape.at.x, shape.at.y);
    return;
  }
  drawArrow(ctx, shape.from, shape.to);
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 12;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4));
  ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}
