import { useState } from 'preact/hooks';
import type { DevtoolsBridge } from '../types.js';

export interface TestRunnerProps {
  bridge: DevtoolsBridge;
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

export function TestRunner({ bridge, projectName, onClose }: TestRunnerProps) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (status === 'running') return;
    setStatus('running');
    setLog('');
    setError(null);
    try {
      const result = await bridge.runTests((line) => {
        setLog((current) => `${current}${line}\n`);
      });
      if (result.cancelled) {
        setStatus('stopped');
        setLog((current) => `${current}\nStopped.\n`);
        return;
      }
      setStatus(result.exitCode === 0 ? 'passed' : 'failed');
      setLog((current) => `${current}\nExited ${result.exitCode}${result.command ? ` (${result.command})` : ''}\n`);
    } catch (caught) {
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
        <button type="button" className="icon-button" data-action="close-tests" onClick={onClose}>
          ✕
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
              void run();
            }}
          >
            Run Test Suite
          </button>
          {status === 'running' ? (
            <button type="button" className="ghost" data-action="stop-tests" onClick={() => bridge.stopTests()}>
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
