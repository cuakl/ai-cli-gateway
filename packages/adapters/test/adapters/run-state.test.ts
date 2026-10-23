import { describe, expect, it } from 'vitest';
import { RunStream } from '../../src/adapters/run-state.js';
import { createStreamEvent } from '../../src/index.js';

describe('RunStream', () => {
  it('numbers chunks and advances the segment after a tool call that follows text', () => {
    const run = new RunStream();
    const chunk = (text: string) => run.accept([createStreamEvent('sess', 'chunk', { text })])[0];
    const call = () => run.accept([createStreamEvent('sess', 'tool_call', { toolName: 'Edit' })])[0];

    expect(chunk('before')?.payload.segment).toBe(0);
    call();
    call();
    expect(chunk('after')?.payload.segment).toBe(1);
    call();
    expect(chunk('later')?.payload.segment).toBe(2);
  });

  it('keeps segment 0 when a tool call happens before any text', () => {
    const run = new RunStream();
    run.accept([createStreamEvent('sess', 'tool_call', { toolName: 'Read' })]);
    const chunk = run.accept([createStreamEvent('sess', 'chunk', { text: 'hi' })])[0];
    expect(chunk?.payload.segment).toBe(0);
  });

  it('pairs tool results to calls in order and keeps a CLI id', () => {
    const run = new RunStream();
    const first = run.accept([createStreamEvent('sess', 'tool_call', { toolName: 'Read' })])[0];
    const second = run.accept([
      createStreamEvent('sess', 'tool_call', { toolName: 'Edit', toolCallId: 'call_b' }),
    ])[0];
    const resultB = run.accept([
      createStreamEvent('sess', 'tool_result', { toolOutput: 'b', toolCallId: 'call_b' }),
    ])[0];
    const resultA = run.accept([createStreamEvent('sess', 'tool_result', { toolOutput: 'a' })])[0];

    expect(second?.payload.toolCallId).toBe('call_b');
    expect(resultB?.payload.toolCallId).toBe('call_b');
    expect(resultA?.payload.toolCallId).toBe(first?.payload.toolCallId);
    expect(resultA?.payload.toolCallId).not.toBe('call_b');
  });

  it('holds result metrics for the single exit done', () => {
    const run = new RunStream();
    expect(
      run.accept([createStreamEvent('sess', 'done', { text: 'Updated', durationMs: 120, costUsd: 0.01 })]),
    ).toEqual([]);
    expect(run.finish({ durationMs: 4 })).toEqual({ text: 'Updated', durationMs: 120, costUsd: 0.01 });
  });

  it('keeps the wall-clock duration when the CLI did not report one', () => {
    const run = new RunStream();
    run.accept([createStreamEvent('sess', 'done', { text: 'ok' })]);
    expect(run.finish({ durationMs: 15 })).toEqual({ durationMs: 15, text: 'ok' });
  });
});
