import type { ComponentChildren } from 'preact';
import { XIcon } from './icons.js';

export interface DockTab<Id extends string> {
  id: Id;
  label: string;
}

export interface DockHeaderProps<Id extends string> {
  tabs: Array<DockTab<Id>>;
  active: Id;
  onSelect: (id: Id) => void;
  closeAction: string;
  closeLabel: string;
  onClose: () => void;
  sheet?: boolean;
  extra?: ComponentChildren;
}

export function DockHeader<Id extends string>({
  tabs,
  active,
  onSelect,
  closeAction,
  closeLabel,
  onClose,
  sheet = false,
  extra,
}: DockHeaderProps<Id>) {
  return (
    <header className="dock-header">
      {sheet ? <div className="sheet-handle" aria-hidden="true" /> : null}
      <div className="dock-header-row">
        <div className="dock-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {extra}
        <button
          type="button"
          className="icon-button"
          data-action={closeAction}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
    </header>
  );
}
