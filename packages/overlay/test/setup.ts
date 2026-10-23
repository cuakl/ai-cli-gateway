import { beforeEach } from 'vitest';

beforeEach(() => {
  // Node's built-in localStorage global is undefined without --localstorage-file.
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  };
  window.cancelAnimationFrame = () => undefined;
});
