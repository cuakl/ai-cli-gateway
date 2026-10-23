import { describe, expect, it } from 'vitest';
import { inferCurl } from '../src/curl.js';

describe('inferCurl', () => {
  it('emits an equivalent infer command with $AIDEV_TOKEN and no real secret', () => {
    const curl = inferCurl({
      origin: 'http://127.0.0.1:4100/',
      prompt: "say 'hi'",
      provider: 'claude',
      model: 'sonnet',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      stream: true,
    });
    expect(curl).toContain('curl -sN http://127.0.0.1:4100/api/v1/infer');
    expect(curl).toContain('authorization: Bearer $AIDEV_TOKEN');
    expect(curl).toContain('accept: text/event-stream');
    expect(curl).toContain('"provider":"claude"');
    expect(curl).toContain('"model":"sonnet"');
    expect(curl).toContain('"stream":true');
    expect(curl).toContain('"jsonSchema"');
    expect(curl).not.toMatch(/Bearer (?!\$AIDEV_TOKEN)\S/);
    expect(curl).not.toContain('machine_');
  });

  it('omits optional fields when they are empty', () => {
    const curl = inferCurl({ origin: 'http://127.0.0.1:4100', prompt: 'pong' });
    expect(curl).toContain('"messages":[{"role":"user","content":"pong"}]');
    expect(curl).not.toContain('"provider"');
    expect(curl).not.toContain('"model"');
    expect(curl).not.toContain('"jsonSchema"');
  });
});
