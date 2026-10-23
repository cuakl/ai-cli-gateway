import type { ComponentChildren } from 'preact';
import { DockHeader } from './DockHeader.js';
import { SettingsIcon } from './icons.js';
import {
  SIDE_MAX,
  SIDE_MIN,
  type SideTab,
  clampSideWidth,
} from './layout/geometry.js';
import { ResizeHandle } from './ResizeHandle.js';

export interface SideDockProps {
  open: boolean;
  sheet: boolean;
  width: number;
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  onResize: (width: number) => void;
  onClose: () => void;
  onSettings: () => void;
  children: ComponentChildren;
}

const TABS: Array<{ id: SideTab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'diffs', label: 'Review' },
];

export function SideDock({
  open,
  sheet,
  width,
  tab,
  onTab,
  onResize,
  onClose,
  onSettings,
  children,
}: SideDockProps) {
  const closeAction = tab === 'chat' ? 'close-chat' : 'close-diffs';
  const closeLabel = tab === 'chat' ? 'Close chat' : 'Close review';
  return (
    <aside
      className={`side-dock${sheet ? ' sheet' : ''}`}
      hidden={!open}
      style={sheet ? undefined : { width: `${width}px` }}
    >
      {sheet ? null : (
        <ResizeHandle
          orientation="vertical"
          value={width}
          min={SIDE_MIN}
          max={SIDE_MAX}
          label="Resize side dock"
          onChange={(next) => onResize(clampSideWidth(next))}
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
        extra={
          <button
            type="button"
            className="icon-button"
            data-action="settings"
            aria-label="Settings"
            title="Settings"
            onClick={onSettings}
          >
            <SettingsIcon />
          </button>
        }
      />
      <div className="dock-body">{children}</div>
    </aside>
  );
}
