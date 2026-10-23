import type { ComponentChildren } from 'preact';
import { DockHeader } from './DockHeader.js';
import {
  BOTTOM_MIN,
  type BottomTab,
  bottomMaxHeight,
  clampBottomHeight,
} from './layout/geometry.js';
import { ResizeHandle } from './ResizeHandle.js';

export interface BottomDockProps {
  open: boolean;
  sheet: boolean;
  height: number;
  sideOffset: number;
  viewportHeight: number;
  tab: BottomTab;
  onTab: (tab: BottomTab) => void;
  onResize: (height: number) => void;
  onClose: () => void;
  children: ComponentChildren;
}

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'tests', label: 'Tests' },
];

export function BottomDock({
  open,
  sheet,
  height,
  sideOffset,
  viewportHeight,
  tab,
  onTab,
  onResize,
  onClose,
  children,
}: BottomDockProps) {
  const closeAction = tab === 'terminal' ? 'close-terminal' : 'close-tests';
  const closeLabel = tab === 'terminal' ? 'Close terminal' : 'Close tests';
  return (
    <aside
      className={`bottom-dock${sheet ? ' sheet' : ''}${!sheet && sideOffset > 0 ? ' with-side' : ''}`}
      hidden={!open}
      style={
        sheet
          ? undefined
          : {
              height: `${height}px`,
              right: sideOffset > 0 ? `${sideOffset}px` : '0',
            }
      }
    >
      {sheet ? null : (
        <ResizeHandle
          orientation="horizontal"
          value={height}
          min={BOTTOM_MIN}
          max={bottomMaxHeight(viewportHeight)}
          label="Resize bottom dock"
          onChange={(next) => onResize(clampBottomHeight(next, viewportHeight))}
        />
      )}
      <DockHeader
        tabs={TABS}
        active={tab}
        onSelect={onTab}
        closeAction={closeAction}
        closeLabel={closeLabel}
        onClose={onClose}
        sheet={sheet}
      />
      <div className="dock-body">{children}</div>
    </aside>
  );
}
