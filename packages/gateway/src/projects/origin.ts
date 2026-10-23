/**
 * Dev-server origins allowed for script-tag / CORS registration:
 * http(s) on localhost, loopback, or an RFC1918 LAN address.
 */
export function isAllowedDevOrigin(origin: string): boolean {
  try {
    parseDevOrigin(origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalize to `url.origin` (scheme + host + port).
 * Rejects non-http(s), credentials, and hosts that are not localhost / loopback / LAN.
 */
export function parseDevOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalidOrigin(input);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidOrigin(input);
  if (url.username || url.password) throw invalidOrigin(input);
  if (!isLocalOrLanHost(url.hostname)) throw invalidOrigin(input);
  return url.origin;
}

export function invalidOriginMessage(input: string): string {
  return `Invalid --origin "${input}". Use an http(s) URL on localhost, 127.0.0.1, or a private LAN address.`;
}

function invalidOrigin(input: string): Error {
  return new Error(invalidOriginMessage(input));
}

function isLocalOrLanHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  return isPrivateOrLoopbackIPv4(host);
}

function isPrivateOrLoopbackIPv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
