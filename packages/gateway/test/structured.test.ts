import { describe, expect, it } from 'vitest';
import { extractJsonValue, checkStructuredOutput } from '../src/inference/structured.js';
import { renderInferPrompt, schemaSystemInstruction } from '../src/inference/messages.js';

describe('extractJsonValue', () => {
  it('reads a fenced JSON object and ignores prose around it', () => {
    expect(
      extractJsonValue('Sure.\n```json\n{"name":"Lamp","tags":["desk"]}\n```\nDone.'),
    ).toEqual({ name: 'Lamp', tags: ['desk'] });
  });

  it('reads the first object or array in plain text', () => {
    expect(extractJsonValue('here you go {"ok":true} trailing')).toEqual({ ok: true });
    expect(extractJsonValue('tags: ["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns undefined when there is no JSON value', () => {
    expect(extractJsonValue('not json at all')).toBeUndefined();
  });
});

describe('checkStructuredOutput', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    required: ['name', 'tags'],
  };

  it('accepts a matching object', () => {
    const result = checkStructuredOutput(schema, '{"name":"Lamp","tags":["desk"]}');
    expect(result).toEqual({ ok: true, value: { name: 'Lamp', tags: ['desk'] } });
  });

  it('returns Ajv issues when a required field is wrong', () => {
    const result = checkStructuredOutput(schema, '{"name":1,"tags":[]}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).toContain('string');
  });
});

describe('renderInferPrompt', () => {
  it('combines system text, a transcript of prior turns, and the last user message', () => {
    const rendered = renderInferPrompt(
      [
        { role: 'system', content: 'Stay terse.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Name a color' },
      ],
      'Be brief',
      schemaSystemInstruction({ type: 'object' }),
    );
    expect(rendered.instruction).toBe('Name a color');
    expect(rendered.prompt).toContain('<conversation>');
    expect(rendered.prompt).toContain('User: Hi');
    expect(rendered.prompt).toContain('Assistant: Hello');
    expect(rendered.prompt.endsWith('Name a color')).toBe(true);
    expect(rendered.systemPrompt).toContain('Be brief');
    expect(rendered.systemPrompt).toContain('Stay terse.');
    expect(rendered.systemPrompt).toContain('Reply with only a JSON value matching this JSON Schema:');
  });
});
