export interface ToolbarProps {
  inspecting: boolean;
  chatOpen: boolean;
  status: 'connected' | 'idle';
  onToggleInspect: () => void;
  onToggleChat: () => void;
}

export function Toolbar({
  inspecting,
  chatOpen,
  status,
  onToggleInspect,
  onToggleChat,
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="AI DevTools">
      <span className="brand">
        <span
          className="status"
          data-state={status}
          title={status === 'connected' ? 'Gateway connected' : 'Gateway idle'}
        />
        AI DevTools
      </span>
      <button
        type="button"
        data-action="inspect"
        aria-pressed={inspecting}
        onClick={onToggleInspect}
      >
        Inspect
      </button>
      <button type="button" data-action="chat" aria-pressed={chatOpen} onClick={onToggleChat}>
        Chat
      </button>
    </div>
  );
}
