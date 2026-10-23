import type { ComponentChildren } from 'preact';
import { DockHeader } from './DockHeader.js';
import { HistoryIcon, PlusIcon, SettingsIcon } from './icons.js';
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
  onNewChat?: () => void;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
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
  onNewChat,
  historyOpen = false,
  onToggleHistory,
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
          <>
            {tab === 'chat' && onNewChat ? (
              <button
                type="button"
                className="icon-button"
                data-action="new-chat"
                aria-label="New chat"
                title="New chat"
                onClick={onNewChat}
              >
                <PlusIcon />
              </button>
            ) : null}
            {tab === 'chat' && onToggleHistory ? (
              <button
                type="button"
                className="icon-button"
                data-action="history"
                aria-label="History"
                title="History"
                aria-pressed={historyOpen}
                onClick={onToggleHistory}
              >
                <HistoryIcon />
              </button>
            ) : null}
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
          </>
        }
      />
      <div className="dock-body">{children}</div>
    </aside>
  );
}
