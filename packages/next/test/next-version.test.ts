import { describe, expect, it } from 'vitest';
import { supportsExperimentalTurbo, supportsTurbopackRules } from '../src/next-version.js';

describe('Next turbopack config keys', () => {
  it('uses experimental.turbo before Next 16 and turbopack.rules from 15.3', () => {
    expect(supportsExperimentalTurbo({ major: 15, minor: 2 })).toBe(true);
    expect(supportsExperimentalTurbo({ major: 16, minor: 0 })).toBe(false);
    expect(supportsTurbopackRules({ major: 15, minor: 2 })).toBe(false);
    expect(supportsTurbopackRules({ major: 15, minor: 3 })).toBe(true);
    expect(supportsTurbopackRules({ major: 16, minor: 4 })).toBe(true);
    expect(supportsExperimentalTurbo(null)).toBe(true);
    expect(supportsTurbopackRules(null)).toBe(true);
  });
});
