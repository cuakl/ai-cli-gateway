import type { ProviderType } from '@aidev/protocol';
import { useEffect, useRef } from 'preact/hooks';
import { trapFocus } from './focus-trap.js';
import { XIcon } from './icons.js';
import type { DockMode } from './layout/geometry.js';
import type { AutoAttachPrefs } from './prefs.js';
import type { OverlayTheme } from './theme/tokens.js';
import type { WorkspaceConnectionState } from './workspace-client.js';

export interface SettingsModalProps {
  theme: OverlayTheme;
  dockMode: DockMode;
  provider: ProviderType;
  autoAttach: AutoAttachPrefs;
  runTestsAfterAgent: boolean;
  availability: Partial<Record<ProviderType, boolean>>;
  gatewayUrl: string;
  connectionState: WorkspaceConnectionState;
  gatewayVersion: string | null;
  onTheme: (theme: OverlayTheme) => void;
  onDockMode: (mode: DockMode) => void;
  onProvider: (provider: ProviderType) => void;
  onAutoAttach: (next: AutoAttachPrefs) => void;
  onRunTestsAfterAgent: (value: boolean) => void;
  onClose: () => void;
}

const PROVIDERS: Array<{ id: ProviderType; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'antigravity', label: 'Antigravity' },
];

const CONNECTION_LABEL: Record<WorkspaceConnectionState, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  closed: 'Offline',
};

export function SettingsModal({
  theme,
  dockMode,
  provider,
  autoAttach,
  runTestsAfterAgent,
  availability,
  gatewayUrl,
  connectionState,
  gatewayVersion,
  onTheme,
  onDockMode,
  onProvider,
  onAutoAttach,
  onRunTestsAfterAgent,
  onClose,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const known = Object.keys(availability).length > 0;
  const availableProviders = PROVIDERS.filter((item) => !known || availability[item.id] === true);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const close = node.querySelector('[data-action="close-settings"]');
    if (close instanceof HTMLElement) close.focus();
    else node.focus();
    return trapFocus(node);
  }, []);

  return (
    <div
      className="modal-backdrop"
      data-action="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-action="settings-modal"
        tabIndex={-1}
      >
        <header className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button
            type="button"
            className="icon-button"
            data-action="close-settings"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-section" aria-labelledby="aid-settings-general">
            <h3 id="aid-settings-general">General</h3>
            <fieldset className="settings-fieldset">
              <legend>Theme</legend>
              <label>
                <input
                  type="radio"
                  name="aid-theme"
                  value="dark"
                  data-action="theme-dark"
                  checked={theme === 'dark'}
                  onChange={() => onTheme('dark')}
                />
                Dark
              </label>
              <label>
                <input
                  type="radio"
                  name="aid-theme"
                  value="light"
                  data-action="theme-light"
                  checked={theme === 'light'}
                  onChange={() => onTheme('light')}
                />
                Light
              </label>
              <label>
                <input
                  type="radio"
                  name="aid-theme"
                  value="system"
                  data-action="theme-system"
                  checked={theme === 'system'}
                  onChange={() => onTheme('system')}
                />
                System
              </label>
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend>Dock behavior</legend>
              <label>
                <input
                  type="radio"
                  name="aid-dock"
                  value="push"
                  data-action="dock-push"
                  checked={dockMode === 'push'}
                  onChange={() => onDockMode('push')}
                />
                Push the page
              </label>
              <label>
                <input
                  type="radio"
                  name="aid-dock"
                  value="overlay"
                  data-action="dock-overlay"
                  checked={dockMode === 'overlay'}
                  onChange={() => onDockMode('overlay')}
                />
                Overlay the page
              </label>
            </fieldset>
          </section>
          <section className="settings-section" aria-labelledby="aid-settings-agent">
            <h3 id="aid-settings-agent">Agent</h3>
            <label className="settings-field">
              <span>Default provider</span>
              <select
                data-action="settings-provider"
                aria-label="Default provider"
                value={provider}
                onChange={(event) => {
                  const match = PROVIDERS.find((item) => item.id === event.currentTarget.value);
                  if (match) onProvider(match.id);
                }}
              >
                {availableProviders.length === 0
                  ? PROVIDERS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))
                  : availableProviders.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
              </select>
            </label>
            <fieldset className="settings-fieldset">
              <legend>Auto-attach</legend>
              <label>
                <input
                  type="checkbox"
                  data-action="auto-attach-console"
                  checked={autoAttach.consoleErrors}
                  onChange={(event) => onAutoAttach({ ...autoAttach, consoleErrors: event.currentTarget.checked })}
                />
                Console errors
              </label>
              <label>
                <input
                  type="checkbox"
                  data-action="auto-attach-network"
                  checked={autoAttach.failedRequests}
                  onChange={(event) => onAutoAttach({ ...autoAttach, failedRequests: event.currentTarget.checked })}
                />
                Failed requests
              </label>
              <label>
                <input
                  type="checkbox"
                  data-action="auto-attach-screenshot"
                  checked={autoAttach.screenshot}
                  onChange={(event) => onAutoAttach({ ...autoAttach, screenshot: event.currentTarget.checked })}
                />
                Screenshot
              </label>
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend>Tests</legend>
              <label>
                <input
                  type="checkbox"
                  data-action="run-tests-after-agent"
                  checked={runTestsAfterAgent}
                  onChange={(event) => onRunTestsAfterAgent(event.currentTarget.checked)}
                />
                Run tests after each agent run
              </label>
            </fieldset>
          </section>
          <section className="settings-section" aria-labelledby="aid-settings-connection">
            <h3 id="aid-settings-connection">Connection</h3>
            <dl className="settings-meta">
              <div>
                <dt>Gateway URL</dt>
                <dd>
                  <code>{gatewayUrl}</code>
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd data-action="connection-state">{CONNECTION_LABEL[connectionState]}</dd>
              </div>
              <div>
                <dt>Gateway version</dt>
                <dd data-action="gateway-version">{gatewayVersion ?? 'Unknown'}</dd>
              </div>
            </dl>
            <a className="ghost settings-link" href={gatewayUrl} target="_blank" rel="noreferrer">
              Open dashboard
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
