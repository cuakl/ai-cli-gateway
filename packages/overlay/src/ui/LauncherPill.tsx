import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  CrosshairIcon,
  FlaskConicalIcon,
  GitCompareIcon,
  GripVerticalIcon,
  LoaderIcon,
  MessageSquareIcon,
  TerminalIcon,
} from './icons.js';
import type { BottomTab, PillCorner, SideTab } from './layout/geometry.js';
import { snapCorner } from './layout/geometry.js';

export type PillStatus = 'connected' | 'running' | 'idle';

export interface LauncherPillProps {
  inspecting: boolean;
  sideOpen: boolean;
  sideTab: SideTab;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  diffCount: number;
  chatUnread: boolean;
  status: PillStatus;
  compact: boolean;
  corner: PillCorner;
  insetInline: number;
  insetBlock: number;
  onMove: (corner: PillCorner) => void;
  onToggleInspect: () => void;
  onSelectChat: () => void;
  onSelectReview: () => void;
  onSelectTerminal: () => void;
  onSelectTests: () => void;
}

const STATUS_LABEL: Record<PillStatus, string> = {
  connected: 'Gateway connected',
  running: 'Run active',
  idle: 'Gateway offline',
};

export function LauncherPill({
  inspecting,
  sideOpen,
  sideTab,
  bottomOpen,
  bottomTab,
  diffCount,
  chatUnread,
  status,
  compact,
  corner,
  insetInline,
  insetBlock,
  onMove,
  onToggleInspect,
  onSelectChat,
  onSelectReview,
  onSelectTerminal,
  onSelectTests,
}: LauncherPillProps) {
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const origin = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const style = drag
    ? { left: `${drag.left}px`, top: `${drag.top}px`, right: 'auto', bottom: 'auto' }
    : {
        [corner.endsWith('right') ? 'right' : 'left']: `${insetInline}px`,
        [corner.startsWith('top') ? 'top' : 'bottom']: `${insetBlock}px`,
      };

  return (
    <div
      className={`toolbar pill${compact ? ' pill-compact' : ''}${drag ? ' pill-dragging' : ''}`}
      data-corner={corner}
      role="toolbar"
      aria-label="AI DevTools"
      style={style}
    >
      <button
        type="button"
        className="icon-button pill-grip"
        data-action="move-pill"
        aria-label="Move launcher"
        title="Move launcher"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = event.currentTarget.closest('.pill')?.getBoundingClientRect();
          if (!rect) return;
          origin.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
          setDrag({ left: rect.left, top: rect.top });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!origin.current) return;
          setDrag({
            left: origin.current.left + (event.clientX - origin.current.x),
            top: origin.current.top + (event.clientY - origin.current.y),
          });
        }}
        onPointerUp={(event) => {
          origin.current = null;
          setDrag(null);
          onMove(snapCorner(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
        }}
        onPointerCancel={() => {
          origin.current = null;
          setDrag(null);
        }}
      >
        <GripVerticalIcon />
      </button>
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span
          className="status"
          data-state={status}
          role="img"
          aria-label={STATUS_LABEL[status]}
          title={STATUS_LABEL[status]}
        >
          {status === 'running' ? <LoaderIcon size={12} /> : null}
        </span>
      </span>
      <PillButton action="inspect" label="Inspect" pressed={inspecting} onClick={onToggleInspect}>
        <CrosshairIcon />
      </PillButton>
      <PillButton
        action="chat"
        label="Chat"
        pressed={sideOpen && sideTab === 'chat'}
        unread={chatUnread}
        onClick={onSelectChat}
      >
        <MessageSquareIcon />
      </PillButton>
      <PillButton
        action="diffs"
        label="Review"
        pressed={sideOpen && sideTab === 'diffs'}
        count={diffCount}
        onClick={onSelectReview}
      >
        <GitCompareIcon />
      </PillButton>
      <PillButton
        action="terminal"
        label="Terminal"
        pressed={bottomOpen && bottomTab === 'terminal'}
        onClick={onSelectTerminal}
      >
        <TerminalIcon />
      </PillButton>
      <PillButton action="tests" label="Tests" pressed={bottomOpen && bottomTab === 'tests'} onClick={onSelectTests}>
        <FlaskConicalIcon />
      </PillButton>
    </div>
  );
}

function PillButton({
  action,
  label,
  pressed,
  count = 0,
  unread = false,
  onClick,
  children,
}: {
  action: string;
  label: string;
  pressed: boolean;
  count?: number;
  unread?: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      data-action={action}
      data-count={action === 'diffs' ? count : undefined}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
      <span className="pill-label">{label}</span>
      {count > 0 ? <span className="count">{count}</span> : null}
      {unread ? <span className="pill-unread" aria-label="Unread reply" /> : null}
    </button>
  );
}
