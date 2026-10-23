import { useState } from 'preact/hooks';
import {
  FileTextIcon,
  LoaderIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
} from '../icons.js';
import type { ToolBlock } from './model.js';

export interface ToolRowProps {
  label: string;
  state: ToolBlock['state'];
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  tools?: readonly ToolBlock[];
}

export function ToolRow({ label, state, name, args, result, tools }: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const details = tools?.length
    ? tools
    : args || result
      ? [{ args, result } as { args?: Record<string, unknown>; result?: string }]
      : [];
  const expandable = details.length > 0;

  return (
    <div className={`tool-row${open ? ' open' : ''}`} data-state={state}>
      <button
        type="button"
        className="tool-row-toggle"
        data-action="tool-row"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => {
          if (expandable) setOpen((value) => !value);
        }}
      >
        <span className="tool-row-icon" aria-hidden="true">
          {toolIcon(name ?? label)}
        </span>
        <span className="tool-row-label">{renderLabel(label)}</span>
        <span className="tool-row-state">{stateMark(state)}</span>
      </button>
      {open ? (
        <div className="tool-row-details">
          {details.map((item, index) => (
            <div key={index} className="tool-row-detail">
              {item.args ? <pre className="tool-args">{stringify(item.args)}</pre> : null}
              {item.result ? <pre className="tool-result">{item.result}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function stateMark(state: ToolBlock['state']) {
  if (state === 'running') return <LoaderIcon size={14} />;
  if (state === 'ok') {
    return (
      <span className="tool-mark ok" aria-label="succeeded">
        ✓
      </span>
    );
  }
  return (
    <span className="tool-mark error" aria-label="failed">
      ✕
    </span>
  );
}

function toolIcon(name: string) {
  const key = name.toLowerCase();
  if (key.includes('write') || key.includes('edit') || key.includes('patch') || key.includes('strreplace')) {
    return <PencilIcon size={14} />;
  }
  if (key.includes('read')) return <FileTextIcon size={14} />;
  if (key.includes('shell') || key.includes('bash') || key.includes('ran')) return <TerminalIcon size={14} />;
  if (key.includes('search') || key.includes('grep') || key.includes('glob')) return <SearchIcon size={14} />;
  return <SparklesIcon size={14} />;
}

function renderLabel(text: string) {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function stringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
