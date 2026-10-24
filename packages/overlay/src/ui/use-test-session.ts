import type { TestReport, TestSummary, WorkspaceServerMessage } from '@aidev/protocol';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { WorkspaceConnection } from './workspace-client.js';

export type TestPanelStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped';

export interface TestRunOptions {
  file?: string;
  onlyFailed?: boolean;
}

export interface TestSession {
  status: TestPanelStatus;
  log: string;
  error: string | null;
  summary: TestSummary | null;
  report: TestReport | undefined;
  running: boolean;
  run: (options?: TestRunOptions) => void;
  stop: () => void;
}

export function useTestSession(
  workspace: WorkspaceConnection,
  onFinished?: (message: Extract<WorkspaceServerMessage, { type: 'test.finished' }>) => void,
): TestSession {
  const [status, setStatus] = useState<TestPanelStatus>('idle');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [report, setReport] = useState<TestReport | undefined>(undefined);
  const runningRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const offOutput = workspace.on('test.output', (message) => {
      setLog((current) => `${current}${message.line}\n`);
    });
    const offFinished = workspace.on('test.finished', (message) => {
      runningRef.current = false;
      if (message.status === 'cancelled') {
        setStatus('stopped');
        setLog((current) => (current.includes('Stopped.') ? current : `${current}\nStopped.\n`));
      } else {
        setStatus(message.status === 'passed' ? 'passed' : 'failed');
      }
      setSummary(message.summary);
      setReport(message.report);
      onFinishedRef.current?.(message);
    });
    return () => {
      offOutput();
      offFinished();
    };
  }, [workspace]);

  const run = useCallback(
    (options?: TestRunOptions) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setStatus('running');
      setLog('');
      setError(null);
      try {
        workspace.send({
          type: 'test.run',
          ...(options?.file ? { file: options.file } : {}),
          ...(options?.onlyFailed ? { onlyFailed: true } : {}),
        });
      } catch (caught) {
        runningRef.current = false;
        setStatus('failed');
        setError(caught instanceof Error ? caught.message : 'Tests failed to start');
      }
    },
    [workspace],
  );

  const stop = useCallback(() => {
    workspace.send({ type: 'test.stop' });
  }, [workspace]);

  return {
    status,
    log,
    error,
    summary,
    report,
    running: status === 'running',
    run,
    stop,
  };
}
