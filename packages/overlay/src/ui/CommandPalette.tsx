import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { trapFocus } from './focus-trap.js';
import { fuzzyFilter } from './fuzzy.js';
import { SearchIcon } from './icons.js';

export interface PaletteItem {
  id: string;
  group: 'Actions' | 'Provider';
  label: string;
  hint?: string;
}

export interface CommandPaletteProps {
  items: PaletteItem[];
  onExecute: (id: string) => void;
  onClose: () => void;
}

const GROUPS: Array<PaletteItem['group']> = ['Actions', 'Provider'];

export function CommandPalette({ items, onExecute, onClose }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(
    () => fuzzyFilter(query, items, (item) => `${item.group} ${item.label} ${item.hint ?? ''}`),
    [items, query],
  );

  useEffect(() => {
    setActive(0);
  }, [query, items]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    inputRef.current?.focus();
    return trapFocus(node);
  }, []);

  function move(delta: number): void {
    if (filtered.length === 0) return;
    setActive((current) => (current + delta + filtered.length) % filtered.length);
  }

  function execute(item: PaletteItem | undefined): void {
    if (!item) return;
    onExecute(item.id);
  }

  return (
    <div
      className="modal-backdrop"
      data-action="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-action="command-palette"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            execute(filtered[active]);
          }
        }}
      >
        <div className="palette-search-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="palette-search"
            aria-label="Command search"
            data-action="palette-search"
            placeholder="Search commands…"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="palette-list" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <p className="palette-empty">No matching commands</p>
          ) : (
            GROUPS.map((group) => {
              const rows = filtered.filter((item) => item.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group} className="palette-group">
                  <div className="palette-heading">{group}</div>
                  {rows.map((item) => {
                    const index = filtered.indexOf(item);
                    const selected = index === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="palette-item"
                        role="option"
                        data-command={item.id}
                        aria-selected={selected}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => execute(item)}
                      >
                        <span>{item.label}</span>
                        {item.hint ? <span className="palette-hint">{item.hint}</span> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
