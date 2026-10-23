import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonTestReport } from '../src/workspace/test-service.js';

const PROJECT = '/tmp/demo-app';

describe('parseJsonTestReport', () => {
  it('parses a captured vitest JSON report', () => {
    const report = parseJsonTestReport(
      JSON.stringify({
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 1,
        numTodoTests: 0,
        testResults: [
          {
            name: path.join(PROJECT, 'src', 'math.test.ts'),
            status: 'failed',
            startTime: 1_000,
            endTime: 1_250,
            assertionResults: [
              {
                title: 'adds',
                fullName: 'math adds',
                status: 'passed',
                duration: 4,
                failureMessages: [],
                location: { line: 4, column: 2 },
              },
              {
                title: 'divides',
                fullName: 'math divides',
                status: 'failed',
                duration: 8,
                failureMessages: ['expected 2 to be 3'],
                location: { line: 12, column: 5 },
              },
              {
                title: 'skipped later',
                fullName: 'math skipped later',
                status: 'skipped',
                duration: 0,
                failureMessages: [],
              },
            ],
          },
        ],
      }),
      PROJECT,
    );
    expect(report?.summary).toMatchObject({ passed: 1, failed: 1, skipped: 1, durationMs: 250 });
    expect(report?.files).toHaveLength(1);
    expect(report?.files[0]).toMatchObject({ path: 'src/math.test.ts', status: 'failed' });
    expect(report?.files[0]?.tests[1]).toMatchObject({
      name: 'divides',
      fullName: 'math divides',
      status: 'failed',
      failureMessages: ['expected 2 to be 3'],
      location: { line: 12, column: 5 },
    });
    expect(report?.files[0]?.tests[0]?.location).toEqual({ line: 4, column: 2 });
  });

  it('parses a captured jest JSON report', () => {
    const report = parseJsonTestReport(
      JSON.stringify({
        numPassedTests: 2,
        numFailedTests: 1,
        numPendingTests: 1,
        numTodoTests: 0,
        success: false,
        testResults: [
          {
            name: path.join(PROJECT, 'src', 'App.test.js'),
            status: 'failed',
            startTime: 1_700_000_000_000,
            endTime: 1_700_000_000_400,
            assertionResults: [
              {
                ancestorTitles: ['App'],
                title: 'renders',
                fullName: 'App renders',
                status: 'passed',
                duration: 5,
                failureMessages: [],
                location: { line: 10, column: 2 },
              },
              {
                ancestorTitles: ['App'],
                title: 'math',
                fullName: 'App math',
                status: 'failed',
                duration: 12,
                failureMessages: ['Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1'],
                location: { line: 18, column: 4 },
              },
              {
                ancestorTitles: ['App'],
                title: 'todo later',
                fullName: 'App todo later',
                status: 'pending',
                duration: 0,
                failureMessages: [],
              },
            ],
          },
        ],
      }),
      PROJECT,
    );
    expect(report?.summary).toMatchObject({ passed: 2, failed: 1, skipped: 1, durationMs: 400 });
    expect(report?.files[0]?.path).toBe('src/App.test.js');
    expect(report?.files[0]?.tests[1]).toMatchObject({
      name: 'math',
      failureMessages: ['Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1'],
      location: { line: 18, column: 4 },
    });
    expect(report?.files[0]?.tests[2]?.status).toBe('skipped');
  });
});
