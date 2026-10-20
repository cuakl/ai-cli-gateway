import { describe, expect, it } from 'vitest';
import { isValidContact, validateContact, type ContactValues } from '../src/components/validation';

const valid: ContactValues = {
  name: 'Ada Lovelace',
  email: 'ada@analytical.engine',
  message: 'The ceramic lamp, please.',
};

describe('validateContact', () => {
  it('accepts a complete note', () => {
    expect(validateContact(valid)).toEqual({});
    expect(isValidContact(valid)).toBe(true);
  });

  it('requires a name, a real email, and a message of at least 10 characters', () => {
    expect(
      validateContact({
        name: ' A ',
        email: 'not-an-email',
        message: 'too short',
      }),
    ).toEqual({
      name: 'Enter your name.',
      email: 'Enter a valid email.',
      message: 'Message should be at least 10 characters.',
    });
  });

  it('trims surrounding whitespace before checking', () => {
    expect(
      validateContact({
        name: '  Ada  ',
        email: '  ada@analytical.engine  ',
        message: '  The oak tray.  ',
      }),
    ).toEqual({});
  });

  it('rejects an email that has no domain', () => {
    expect(validateContact({ ...valid, email: 'ada@' }).email).toBe('Enter a valid email.');
    expect(isValidContact({ ...valid, email: 'ada@' })).toBe(false);
  });
});
