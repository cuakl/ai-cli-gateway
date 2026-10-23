import { beforeEach } from 'vitest';

beforeEach(() => {
  window.sessionStorage?.clear();
  window.history.replaceState(null, '', '/dashboard/');
});
