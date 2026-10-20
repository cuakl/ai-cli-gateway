import { describe, expect, it } from 'vitest';
import {
  FrontendContextPayloadSchema,
  GitCommitRequestSchema,
  GitDiffSummarySchema,
  PromptOptionsSchema,
  PromptRequestSchema,
  UnifiedStreamEventSchema,
  createStreamEvent,
} from '@gateway/shared-types';

describe('shared contracts', () => {
  it('round-trips a unified stream event', () => {
    const event = createStreamEvent('sess_abc123', 'tool_call', {
      toolName: 'Edit',
      toolArgs: { file: 'src/Header.tsx' },
    });

    expect(UnifiedStreamEventSchema.parse(event)).toEqual(event);
    expect(
      createStreamEvent('sess_abc123', 'done', { durationMs: 4900 }).type,
    ).toBe('done');
  });

  it('parses prompt, context, diff, and commit payloads', () => {
    const request = PromptRequestSchema.parse({
      provider: 'antigravity',
      cwd: '/Users/santi/dev/ai-cli-gateway/apps/demo-react-app',
      prompt: 'Change the hero button to emerald-600',
      files: ['src/components/Hero.tsx'],
      yolo: true,
      ephemeral: true,
    });
    expect(request.provider).toBe('antigravity');

    const context = FrontendContextPayloadSchema.parse({
      selectedElement: {
        tagName: 'BUTTON',
        id: 'hero',
        className: 'btn',
        outerHTML: '<button id="hero"></button>',
        computedStyles: { color: 'rgb(0, 0, 0)' },
        sourceLocation: {
          componentName: 'Hero',
          fileName: 'src/components/Hero.tsx',
          lineNumber: 42,
          columnNumber: 5,
          props: { label: 'Click' },
        },
      },
      recentErrors: [],
      recentConsoleLogs: [{ level: 'warn', args: ['slow'], timestamp: 1 }],
      failedNetworkRequests: [{ url: 'https://example.test', status: 500, durationMs: 12 }],
    });
    expect(context.selectedElement?.sourceLocation?.lineNumber).toBe(42);

    const diff = GitDiffSummarySchema.parse({
      branch: 'main',
      files: [
        {
          path: 'src/components/Hero.tsx',
          status: 'modified',
          additions: 2,
          deletions: 1,
        },
      ],
      insertions: 2,
      deletions: 1,
    });
    expect(diff.files).toHaveLength(1);

    const commit = GitCommitRequestSchema.parse({
      message: 'feat(ui): update hero button',
      push: true,
    });
    expect(commit.push).toBe(true);
  });

  it('rejects an empty prompt', () => {
    expect(() => PromptOptionsSchema.parse({ prompt: '', cwd: '/tmp' })).toThrow();
  });
});
