import type { TestReport } from '@aidev/protocol';

/** Canned failing report the e2e WebSocket interceptor injects for Tests → Run. */
export const CANNED_TEST_REPORT: TestReport = {
  summary: { passed: 1, failed: 1, skipped: 0, durationMs: 42 },
  files: [
    {
      path: 'src/components/Hero.test.tsx',
      status: 'failed',
      tests: [
        {
          name: 'renders the hero button',
          fullName: 'Hero renders the hero button',
          status: 'failed',
          durationMs: 8,
          failureMessages: [
            'AssertionError: expected \'primary\' to be \'hero-purple\'\n\nExpected: "hero-purple"\nReceived: "primary"',
          ],
          location: { line: 12, column: 5 },
        },
        {
          name: 'shows the tagline',
          fullName: 'Hero shows the tagline',
          status: 'passed',
          durationMs: 3,
          failureMessages: [],
        },
      ],
    },
  ],
};

export const CANNED_TEST_FINISHED = {
  type: 'test.finished' as const,
  status: 'failed' as const,
  summary: CANNED_TEST_REPORT.summary,
  report: CANNED_TEST_REPORT,
};
