export interface ToolbarProps {
  inspecting: boolean;
  panel: 'chat' | 'diffs' | 'terminal' | 'tests' | null;
  diffCount: number;
  status: 'connected' | 'idle';
  onToggleInspect: () => void;
  onSelectPanel: (panel: 'chat' | 'diffs' | 'terminal' | 'tests') => void;
}

export function Toolbar({ inspecting, panel, diffCount, status, onToggleInspect, onSelectPanel }: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="AI DevTools">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        DevTools
        <span
          className="status"
          data-state={status}
          role="img"
          aria-label={status === 'connected' ? 'Gateway connected' : 'Gateway offline'}
          title={status === 'connected' ? 'Gateway connected' : 'Gateway offline'}
        />
      </span>
      <button type="button" data-action="inspect" aria-pressed={inspecting} onClick={onToggleInspect}>
        Inspect
      </button>
      <button type="button" data-action="chat" aria-pressed={panel === 'chat'} onClick={() => onSelectPanel('chat')}>
        Chat
      </button>
      <button
        type="button"
        data-action="diffs"
        data-count={diffCount}
        aria-pressed={panel === 'diffs'}
        onClick={() => onSelectPanel('diffs')}
      >
        Diffs
        {diffCount > 0 ? <span className="count">{diffCount}</span> : null}
      </button>
      <button
        type="button"
        data-action="terminal"
        aria-pressed={panel === 'terminal'}
        onClick={() => onSelectPanel('terminal')}
      >
        Terminal
      </button>
      <button type="button" data-action="tests" aria-pressed={panel === 'tests'} onClick={() => onSelectPanel('tests')}>
        Tests
      </button>
    </div>
  );
}
