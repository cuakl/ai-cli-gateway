import { useEffect, useRef, useState } from 'preact/hooks';
import { XIcon } from './icons.js';
import type { WorkspaceConnection } from './workspace-client.js';

export interface TestRunnerProps {
  workspace: WorkspaceConnection;
  projectName?: string;
  onClose: () => void;
}

type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped';

const STATUS_LABEL: Record<TestStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function TestRunner({ workspace, projectName, onClose }: TestRunnerProps) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unsubscribe = useRef<Array<() => void>>([]);

  function clearSubs(): void {
    for (const off of unsubscribe.current) off();
    unsubscribe.current = [];
  }

  useEffect(() => clearSubs, []);

  function run(): void {
    if (status === 'running') return;
    clearSubs();
    setStatus('running');
    setLog('');
    setError(null);
    unsubscribe.current = [
      workspace.on('test.output', (message) => {
        setLog((current) => `${current}${message.line}\n`);
      }),
      workspace.on('test.finished', (message) => {
        clearSubs();
        if (message.status === 'cancelled') {
          setStatus('stopped');
          setLog((current) => `${current}\nStopped.\n`);
          return;
        }
        setStatus(message.status === 'passed' ? 'passed' : 'failed');
      }),
    ];
    try {
      workspace.send({ type: 'test.run' });
    } catch (caught) {
      clearSubs();
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Tests failed to start');
    }
  }

  return (
    <section className="drawer wide" aria-label="Tests">
      <header className="drawer-header">
        <div className="header-copy">
          <p className="kicker">{projectName?.trim() || 'Tests'}</p>
          <h2>Tests</h2>
        </div>
        <span className="badge" data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        <button
          type="button"
          className="icon-button"
          data-action="close-tests"
          aria-label="Close tests"
          title="Close tests"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </header>
      <div className="test-toolbar">
        <div className="test-actions">
          <button
            type="button"
            className="primary"
            data-action="run-tests"
            disabled={status === 'running'}
            onClick={() => {
              run();
            }}
          >
            Run Test Suite
          </button>
          {status === 'running' ? (
            <button type="button" className="ghost" data-action="stop-tests" onClick={() => workspace.send({ type: 'test.stop' })}>
              Stop
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <pre className="test-log" aria-live="polite">
        {log || 'Test output will appear here.'}
      </pre>
    </section>
  );
}
