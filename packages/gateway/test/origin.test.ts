import { describe, expect, it } from 'vitest';
import { isAllowedDevOrigin, parseDevOrigin } from '../src/projects/origin.js';

describe('dev origin allowlist', () => {
  it('accepts localhost, loopback, and RFC1918 LAN http(s) URLs', () => {
    expect(parseDevOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseDevOrigin('https://localhost')).toBe('https://localhost');
    expect(parseDevOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(parseDevOrigin('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(parseDevOrigin('http://192.168.1.10:5173')).toBe('http://192.168.1.10:5173');
    expect(parseDevOrigin('http://10.0.0.5')).toBe('http://10.0.0.5');
    expect(parseDevOrigin('http://172.16.0.1')).toBe('http://172.16.0.1');
    expect(parseDevOrigin('http://172.31.255.1:80')).toBe('http://172.31.255.1');
    expect(parseDevOrigin('http://localhost:3000/app')).toBe('http://localhost:3000');
  });

  it('rejects public hosts, credentials, and non-http schemes', () => {
    expect(isAllowedDevOrigin('https://evil.example')).toBe(false);
    expect(isAllowedDevOrigin('http://8.8.8.8')).toBe(false);
    expect(isAllowedDevOrigin('http://172.15.0.1')).toBe(false);
    expect(isAllowedDevOrigin('http://172.32.0.1')).toBe(false);
    expect(isAllowedDevOrigin('ftp://localhost')).toBe(false);
    expect(isAllowedDevOrigin('http://user:pass@localhost:3000')).toBe(false);
    expect(isAllowedDevOrigin('not-a-url')).toBe(false);
  });
});
