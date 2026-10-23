import { useRef } from 'preact/hooks';
import { RESIZE_STEP, clamp } from './layout/geometry.js';

export interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}

export function ResizeHandle({ orientation, value, min, max, label, onChange }: ResizeHandleProps) {
  const drag = useRef<{ pointer: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';

  function applyDelta(delta: number): void {
    onChange(clamp(drag.current ? drag.current.value + delta : value + delta, min, max));
  }

  return (
    <div
      className={`resize-handle ${vertical ? 'resize-side' : 'resize-bottom'}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointer: vertical ? event.clientX : event.clientY, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const pointer = vertical ? event.clientX : event.clientY;
        const delta = drag.current.pointer - pointer;
        onChange(clamp(drag.current.value + delta, min, max));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (vertical && event.key === 'ArrowLeft') {
          event.preventDefault();
          applyDelta(RESIZE_STEP);
        } else if (vertical && event.key === 'ArrowRight') {
          event.preventDefault();
          applyDelta(-RESIZE_STEP);
        } else if (!vertical && event.key === 'ArrowUp') {
          event.preventDefault();
          applyDelta(RESIZE_STEP);
        } else if (!vertical && event.key === 'ArrowDown') {
          event.preventDefault();
          applyDelta(-RESIZE_STEP);
        }
      }}
    />
  );
}
