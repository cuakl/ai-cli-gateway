import type { CLIAdapter, ExecuteResult } from '@aidev/adapters';
import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@aidev/protocol';
import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../src/sessions/registry.js';

class NopAdapter implements CLIAdapter {
  readonly provider = 'cursor' as const;
  readonly killed: string[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getBinaryPath(): Promise<string> {
    return '/mock/cursor';
  }

  async execute(
    _options: PromptOptions,
    _onEvent: (event: UnifiedStreamEvent) => void,
  ): Promise<ExecuteResult> {
    return { exitCode: 0, summary: '' };
  }

  async kill(sessionId: string): Promise<boolean> {
    this.killed.push(sessionId);
    return true;
  }
}

function event(id: string, type: UnifiedStreamEvent['type'] = 'chunk'): UnifiedStreamEvent {
  return createStreamEvent('sess_buffer', type, { text: id }, id, 1);
}

describe('SessionRegistry', () => {
  it('replays buffered events and then delivers live ones once', () => {
    const registry = new SessionRegistry();
    const adapter = new NopAdapter();
    registry.create({ id: 'sess_buffer', provider: 'cursor', cwd: '/tmp', adapter });
    registry.append('sess_buffer', event('early', 'init'));

    const live: string[] = [];
    const subscription = registry.subscribe('sess_buffer', (item) => live.push(item.id));
    registry.append('sess_buffer', event('late'));
    subscription?.unsubscribe();
    registry.append('sess_buffer', event('after'));

    expect(subscription?.events.map((item) => item.id)).toEqual(['early']);
    expect(live).toEqual(['late']);
    expect(registry.events('sess_buffer')?.map((item) => item.id)).toEqual(['early', 'late', 'after']);
    registry.dispose();
  });

  it('keeps only the most recent events when maxEvents is set', () => {
    const registry = new SessionRegistry({ maxEvents: 2 });
    registry.create({
      id: 'sess_buffer',
      provider: 'cursor',
      cwd: '/tmp',
      adapter: new NopAdapter(),
    });
    registry.append('sess_buffer', event('one'));
    registry.append('sess_buffer', event('two'));
    registry.append('sess_buffer', event('three'));
    expect(registry.events('sess_buffer')?.map((item) => item.id)).toEqual(['two', 'three']);
    registry.dispose();
  });

  it('keeps a killed session killed when the process exit is recorded', () => {
    const registry = new SessionRegistry();
    registry.create({
      id: 'sess_kill',
      provider: 'cursor',
      cwd: '/tmp',
      adapter: new NopAdapter(),
    });
    expect(registry.markKilled('sess_kill')?.status).toBe('killed');
    expect(registry.finish('sess_kill', { status: 'failed', exitCode: 1 })).toMatchObject({
      status: 'killed',
      exitCode: 1,
    });
    expect(registry.markKilled('sess_missing')).toBeUndefined();
    registry.dispose();
  });

  it('drops finished sessions after the ttl and signals running ones on dispose', async () => {
    const registry = new SessionRegistry({ ttlMs: 30 });
    const adapter = new NopAdapter();
    try {
      registry.create({ id: 'sess_done', provider: 'cursor', cwd: '/tmp', adapter });
      registry.create({ id: 'sess_live', provider: 'cursor', cwd: '/tmp', adapter });
      registry.finish('sess_done', { status: 'completed', exitCode: 0 });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(registry.get('sess_done')).toBeUndefined();
      expect(registry.get('sess_live')?.status).toBe('running');
    } finally {
      registry.dispose();
    }
    expect(adapter.killed).toEqual(['sess_live']);
  });
});
