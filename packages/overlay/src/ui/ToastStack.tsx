import { XIcon } from './icons.js';
import type { PillCorner } from './layout/geometry.js';
import { PILL_HEIGHT } from './layout/geometry.js';

export interface ToastAction {
  label: string;
  action: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  text: string;
  tone?: 'info' | 'error';
  actions?: ToastAction[];
}

export interface ToastStackProps {
  toasts: Toast[];
  corner: PillCorner;
  offset: { inline: number; block: number };
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, corner, offset, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  const atBottom = corner.startsWith('bottom');
  return (
    <div
      className="toast-stack"
      data-corner={corner}
      style={{
        ...stackStyle(corner, offset),
        flexDirection: atBottom ? 'column-reverse' : 'column',
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.tone === 'error' ? ' toast-error' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.actions?.map((action) => (
            <button key={action.action} type="button" data-action={action.action} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className="icon-button"
            data-action="dismiss-notice"
            aria-label="Dismiss notification"
            title="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function stackStyle(
  corner: PillCorner,
  offset: { inline: number; block: number },
): Record<string, string> {
  const edge = `${offset.block + PILL_HEIGHT + 8}px`;
  const inset = `${offset.inline}px`;
  if (corner === 'bottom-right') return { right: inset, bottom: edge, left: 'auto', top: 'auto' };
  if (corner === 'bottom-left') return { left: inset, bottom: edge, right: 'auto', top: 'auto' };
  if (corner === 'top-right') return { right: inset, top: edge, left: 'auto', bottom: 'auto' };
  return { left: inset, top: edge, right: 'auto', bottom: 'auto' };
}
