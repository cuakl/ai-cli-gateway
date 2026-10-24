import { useState } from 'preact/hooks';
import type { TestCaseResult, TestFileResult, TestReport, TestSummary } from '@aidev/protocol';
import { EmptyState } from './EmptyState.js';
import { FlaskConicalIcon, LoaderIcon } from './icons.js';
import {
  firstFailureMessage,
  formatTestSummaryBar,
  parseExpectedReceived,
  reportHasFailures,
  type TestFailureFix,
} from './test-report.js';
import type { TestPanelStatus } from './use-test-session.js';
import type { WorkspaceConnection } from './workspace-client.js';

export interface TestRunnerProps {
  workspace: WorkspaceConnection;
  projectName?: string;
  status: TestPanelStatus;
  log: string;
  error: string | null;
  summary: TestSummary | null;
  report: TestReport | undefined;
  running: boolean;
  runTestsAfterAgent: boolean;
  onRunTestsAfterAgent: (value: boolean) => void;
  onRun: (options?: { file?: string; onlyFailed?: boolean }) => void;
  onStop: () => void;
  onFix: (failure: TestFailureFix) => void;
}

const STATUS_LABEL: Record<TestPanelStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function TestRunner({
  workspace,
  projectName,
  status,
  log,
  error,
  summary,
  report,
  running,
  runTestsAfterAgent,
  onRunTestsAfterAgent,
  onRun,
  onStop,
  onFix,
}: TestRunnerProps) {
  const idle = status === 'idle' && !log && !report && !summary;
  const canRerunFailed = !running && reportHasFailures(report);

  return (
    <section className="panel" aria-label="Tests" aria-busy={running}>
      <div className="test-toolbar">
        <p className="kicker">{projectName?.trim() || 'Tests'}</p>
        <div className="test-actions">
          <span className="badge" data-status={status}>
            {running ? <LoaderIcon size={12} /> : null}
            {STATUS_LABEL[status]}
          </span>
          <button
            type="button"
            className="primary"
            data-action="run-tests"
            disabled={running}
            onClick={() => {
              onRun();
            }}
          >
            {running ? <LoaderIcon size={14} /> : null}
            Run
          </button>
          {running ? (
            <button type="button" className="ghost" data-action="stop-tests" onClick={onStop}>
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            data-action="rerun-failed"
            disabled={!canRerunFailed}
            onClick={() => {
              onRun({ onlyFailed: true });
            }}
          >
            Re-run failed
          </button>
        </div>
      </div>
      <div className="test-settings">
        <label className="test-auto-run">
          <input
            type="checkbox"
            data-action="run-tests-after-agent"
            checked={runTestsAfterAgent}
            onChange={(event) => onRunTestsAfterAgent(event.currentTarget.checked)}
          />
          Run tests after each agent run
        </label>
      </div>
      {summary ? (
        <p className="test-summary" data-action="test-summary">
          {formatTestSummaryBar(summary)}
        </p>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {idle ? (
        <EmptyState
          icon={<FlaskConicalIcon size={24} />}
          title="No results yet"
          hint="Run the project test suite. Failures expand with the expected/received diff."
        />
      ) : report && report.files.length > 0 ? (
        <TestTree report={report} workspace={workspace} running={running} onRunFile={(file) => onRun({ file })} onFix={onFix} />
      ) : (
        <pre className="test-log" aria-live="polite">
          {log || 'Test output will appear here.'}
        </pre>
      )}
    </section>
  );
}

function TestTree({
  report,
  workspace,
  running,
  onRunFile,
  onFix,
}: {
  report: TestReport;
  workspace: WorkspaceConnection;
  running: boolean;
  onRunFile: (file: string) => void;
  onFix: (failure: TestFailureFix) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  function isOpen(key: string, failed: boolean): boolean {
    return open[key] ?? failed;
  }

  function toggle(key: string, failed: boolean): void {
    setOpen((current) => ({ ...current, [key]: !(current[key] ?? failed) }));
  }

  return (
    <ul className="test-tree">
      {report.files.map((file) => {
        const fileKey = `file:${file.path}`;
        const fileOpen = isOpen(fileKey, file.status === 'failed');
        return (
          <li key={file.path} className="test-file" data-status={file.status} data-test-file={file.path} data-test-status={file.status}>
            <div className="test-file-row">
              <button
                type="button"
                className="test-node"
                aria-expanded={fileOpen}
                onClick={() => toggle(fileKey, file.status === 'failed')}
              >
                <span className="test-node-status">{statusMark(file.status)}</span>
                <span className="test-node-label">{file.path}</span>
              </button>
              <button
                type="button"
                className="ghost"
                data-action="run-file"
                data-file={file.path}
                disabled={running}
                onClick={() => onRunFile(file.path)}
              >
                Run this file
              </button>
            </div>
            {fileOpen ? (
              <ul className="test-cases">
                {file.tests.map((test) => (
                  <TestCaseRow
                    key={`${file.path}:${test.fullName || test.name}`}
                    file={file}
                    test={test}
                    open={isOpen(`test:${file.path}:${test.fullName || test.name}`, test.status === 'failed')}
                    onToggle={() => toggle(`test:${file.path}:${test.fullName || test.name}`, test.status === 'failed')}
                    workspace={workspace}
                    onFix={onFix}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TestCaseRow({
  file,
  test,
  open,
  onToggle,
  workspace,
  onFix,
}: {
  file: TestFileResult;
  test: TestCaseResult;
  open: boolean;
  onToggle: () => void;
  workspace: WorkspaceConnection;
  onFix: (failure: TestFailureFix) => void;
}) {
  const message = firstFailureMessage(test.failureMessages);
  const diff = message ? parseExpectedReceived(message) : null;
  const locationFile = testLocationFile(test) ?? file.path;

  return (
    <li className="test-case" data-status={test.status} data-test-name={test.name} data-test-status={test.status}>
      <button type="button" className="test-node" aria-expanded={test.status === 'failed' ? open : undefined} onClick={onToggle}>
        <span className="test-node-status">{statusMark(test.status)}</span>
        <span className="test-node-label">{test.name}</span>
      </button>
      {open && test.status === 'failed' ? (
        <div className="test-failure">
          {diff ? (
            <div className="test-diff">
              <div className="test-diff-side" data-side="expected">
                <p className="test-diff-label">Expected</p>
                <pre className="test-diff-value">{diff.expected}</pre>
              </div>
              <div className="test-diff-side" data-side="received">
                <p className="test-diff-label">Received</p>
                <pre className="test-diff-value">{diff.received}</pre>
              </div>
            </div>
          ) : (
            <pre className="test-failure-message">{message || 'Test failed.'}</pre>
          )}
          <div className="test-failure-actions">
            <button
              type="button"
              className="ghost"
              data-action="open-source"
              onClick={() => {
                void workspace.request({
                  type: 'editor.open',
                  file: locationFile,
                  ...(test.location?.line != null ? { line: test.location.line } : {}),
                  ...(test.location?.column != null ? { column: test.location.column } : {}),
                });
              }}
            >
              Open in editor
            </button>
            <button
              type="button"
              className="ghost"
              data-action="fix-with-ai"
              onClick={() =>
                onFix({
                  name: test.name,
                  file: locationFile,
                  message,
                  ...(test.location?.line != null ? { line: test.location.line } : {}),
                  ...(test.location?.column != null ? { column: test.location.column } : {}),
                })
              }
            >
              Fix with AI
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function statusMark(status: 'passed' | 'failed' | 'skipped'): string {
  if (status === 'failed') return 'failed';
  if (status === 'passed') return 'passed';
  return 'skipped';
}

function testLocationFile(test: TestCaseResult): string | undefined {
  const location = test.location as { file?: unknown } | undefined;
  return typeof location?.file === 'string' && location.file.length > 0 ? location.file : undefined;
}
