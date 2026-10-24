import type { TestReport, TestStatus, TestSummary } from '@aidev/protocol';
import { formatDuration } from './chat/RunFooter.js';
import { type ContextChip } from './chat/model.js';

const PREVIEW_LIMIT = 280;

export interface ExpectedReceived {
  expected: string;
  received: string;
}

export interface TestFailureFix {
  name: string;
  file: string;
  message: string;
  line?: number;
  column?: number;
}

/** Pull Jest/Vitest `Expected:` / `Received:` lines out of a failure message. */
export function parseExpectedReceived(message: string): ExpectedReceived | null {
  const labeled = labeledExpectedReceived(message);
  if (labeled) return labeled;
  return blockExpectedReceived(message);
}

export function firstFailureMessage(messages: readonly string[]): string {
  return messages.find((item) => item.trim().length > 0) ?? '';
}

export function formatTestSummaryBar(summary: TestSummary): string {
  return `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped · ${formatDuration(summary.durationMs)}`;
}

export function formatTestFooter(status: TestStatus, summary: TestSummary): string {
  if (status === 'cancelled') return 'Tests: stopped';
  if (summary.failed > 0) return `Tests: ${summary.failed} failed`;
  if (summary.passed > 0) return `Tests: ${summary.passed} passed`;
  return status === 'passed' ? 'Tests: passed' : 'Tests: failed';
}

export function chipFromTestFailure(input: TestFailureFix): ContextChip {
  const preview = previewText([input.file, input.message].filter(Boolean).join('\n'));
  return {
    id: `test:${input.file}:${input.name}`,
    kind: 'test',
    label: input.name.trim() || 'Test failure',
    preview,
    file: input.file,
    ...(input.line != null ? { line: input.line } : {}),
    ...(input.column != null ? { column: input.column } : {}),
  };
}

export function reportHasFailures(report: TestReport | undefined): boolean {
  return Boolean(report?.files.some((file) => file.status === 'failed' || file.tests.some((test) => test.status === 'failed')));
}

function labeledExpectedReceived(message: string): ExpectedReceived | null {
  const expected = message.match(/^[ \t]*Expected:[ \t]*(.*)$/m);
  const received = message.match(/^[ \t]*Received:[ \t]*(.*)$/m);
  if (!expected || !received) return null;
  return { expected: expected[1] ?? '', received: received[1] ?? '' };
}

function blockExpectedReceived(message: string): ExpectedReceived | null {
  const match = message.match(/^[ \t]*-[ \t]*Expected[ \t]*\n[ \t]*\+[ \t]*Received[ \t]*\n+(?:[ \t]*\n)?[ \t]*-[ \t]*(.*)\n[ \t]*\+[ \t]*(.*)/m);
  if (!match) return null;
  return { expected: match[1] ?? '', received: match[2] ?? '' };
}

function previewText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, PREVIEW_LIMIT)}…`;
}
