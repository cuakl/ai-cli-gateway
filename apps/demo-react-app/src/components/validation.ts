export interface ContactValues {
  name: string;
  email: string;
  message: string;
}

export interface ContactErrors {
  name?: string;
  email?: string;
  message?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors for the studio note form. An empty object means the values are valid. */
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const message = values.message.trim();
  if (name.length < 2) errors.name = 'Enter your name.';
  if (!EMAIL.test(email)) errors.email = 'Enter a valid email.';
  if (message.length < 10) errors.message = 'Message should be at least 10 characters.';
  return errors;
}

export function isValidContact(values: ContactValues): boolean {
  return Object.keys(validateContact(values)).length === 0;
}
