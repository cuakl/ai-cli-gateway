import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/ui/fuzzy.js';

describe('fuzzyScore', () => {
  it('scores empty queries, exact matches, prefixes, and substrings', () => {
    expect(fuzzyScore('', 'Hello')).toBe(1);
    expect(fuzzyScore('  ', 'Hello')).toBe(1);
    expect(fuzzyScore('hello', 'Hello')).toBe(1_000);
    expect(fuzzyScore('he', 'Hello')).toBe(500 - 'hello'.length);
    expect(fuzzyScore('ell', 'Hello')).toBe(200 - 1);
  });

  it('scores subsequences and rejects misses', () => {
    expect(fuzzyScore('hlo', 'Hello')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Hello')).toBeNull();
  });
});

describe('fuzzyFilter', () => {
  it('ranks exact over prefix over substring and drops misses', () => {
    const items = [
      { id: 'sub', text: 'xxhello' },
      { id: 'prefix', text: 'hello world' },
      { id: 'exact', text: 'Hello' },
      { id: 'miss', text: 'world' },
    ];
    expect(fuzzyFilter('hello', items, (item) => item.text).map((item) => item.id)).toEqual([
      'exact',
      'prefix',
      'sub',
    ]);
  });

  it('returns every item when the query is blank', () => {
    const items = [{ text: 'b' }, { text: 'a' }];
    expect(fuzzyFilter('  ', items, (item) => item.text)).toEqual(items);
  });
});
