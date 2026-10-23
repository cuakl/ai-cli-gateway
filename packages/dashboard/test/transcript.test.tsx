import { createStreamEvent, type Run, type ThreadEvent } from '@aidev/protocol';
import { options, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadTranscript } from '../src/thread-transcript.js';

options.debounceRendering = (callback) => {
  callback();
};

describe('ThreadTranscript', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a stored overlay transcript from runs and JSONL events', () => {
    const run: Run = {
      id: 'run_stored',
      threadId: 'thr_stored',
      prompt: 'Tint the hero green',
      contextSummary: null,
      attachments: [],
      status: 'succeeded',
      startedAt: 1,
      endedAt: 2,
      checkpoint: null,
      filesTouched: ['src/Hero.tsx'],
      error: null,
      usage: { durationMs: 1200 },
    };
    const events: ThreadEvent[] = [
      { runId: run.id, event: createStreamEvent('sess_1', 'chunk', { text: 'Looking at `Hero.tsx`.', segment: 0 }) },
      {
        runId: run.id,
        event: createStreamEvent('sess_1', 'tool_call', {
          toolName: 'Read',
          toolCallId: 'c1',
          toolArgs: { path: 'src/Hero.tsx' },
        }),
      },
      {
        runId: run.id,
        event: createStreamEvent('sess_1', 'tool_result', { toolCallId: 'c1', toolOutput: 'export function Hero() {}' }),
      },
      {
        runId: run.id,
        event: createStreamEvent('sess_1', 'chunk', { text: 'The hero is now **green**.', segment: 1 }),
      },
      {
        runId: run.id,
        event: createStreamEvent('sess_1', 'done', { durationMs: 1200 }),
      },
    ];

    const host = document.createElement('div');
    document.body.append(host);
    render(<ThreadTranscript runs={[run]} events={events} />, host);

    expect(host.textContent).toContain('Tint the hero green');
    expect(host.querySelector('.markdown p')?.textContent).toBe('Looking at Hero.tsx.');
    expect(host.textContent).toContain('The hero is now');
    expect(host.querySelector('strong')?.textContent).toBe('green');
    expect(host.querySelector('.tool-row')?.textContent).toMatch(/Read/);
    expect(host.querySelector('.markdown')).toBeTruthy();
  });
});
