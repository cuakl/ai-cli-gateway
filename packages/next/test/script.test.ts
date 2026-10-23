import { afterEach, describe, expect, it, vi } from 'vitest';
import { AidevScript, serializeAidevConfig } from '../src/script.js';

describe('AidevScript', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_AIDEV_GATEWAY_URL', 'http://127.0.0.1:4100');
    expect(AidevScript()).toBeNull();
  });

  it('escapes < in the inline config JSON', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_AIDEV_GATEWAY_URL', 'http://127.0.0.1:4100');
    vi.stubEnv('NEXT_PUBLIC_AIDEV_PROJECT_ID', 'proj_1');
    vi.stubEnv('NEXT_PUBLIC_AIDEV_BROWSER_TOKEN', 'tok');
    vi.stubEnv('NEXT_PUBLIC_AIDEV_PROJECT_NAME', '</script><img src=x onerror=alert(1)>');
    const node = AidevScript();
    expect(node).not.toBeNull();
    const html = inlineScriptHtml(node);
    expect(html).toContain('\\u003c');
    expect(html).not.toContain('</script>');
    expect(html).toContain('window.__AI_DEVTOOLS__');
    expect(overlaySrc(node)).toBe('http://127.0.0.1:4100/overlay.js');
    expect(overlayDefer(node)).toBe(true);
  });

  it('serializeAidevConfig escapes angle brackets', () => {
    expect(serializeAidevConfig({ gatewayUrl: 'http://x', projectName: 'a<b' })).toContain('\\u003c');
    expect(serializeAidevConfig({ gatewayUrl: 'http://x', projectName: 'a<b' })).not.toContain('a<b');
  });
});

function inlineScriptHtml(node: unknown): string {
  const scripts = collect(node);
  const inline = scripts.find((item) => typeof item.dangerouslySetInnerHTML?.__html === 'string');
  return inline?.dangerouslySetInnerHTML?.__html ?? '';
}

function overlaySrc(node: unknown): string | undefined {
  return collect(node).find((item) => typeof item.src === 'string')?.src;
}

function overlayDefer(node: unknown): boolean | undefined {
  return collect(node).find((item) => typeof item.src === 'string')?.defer;
}

function collect(node: unknown): Array<{
  src?: string;
  defer?: boolean;
  dangerouslySetInnerHTML?: { __html?: string };
  children?: unknown;
}> {
  if (!node || typeof node !== 'object') return [];
  const el = node as {
    props?: {
      src?: string;
      defer?: boolean;
      dangerouslySetInnerHTML?: { __html?: string };
      children?: unknown;
    };
  };
  const self = el.props ? [el.props] : [];
  const children = el.props?.children;
  if (Array.isArray(children)) {
    return [...self, ...children.flatMap((child) => collect(child))];
  }
  if (children) return [...self, ...collect(children)];
  return self;
}
