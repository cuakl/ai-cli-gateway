/**
 * Stream a prompt through a running gateway and write text chunks to stdout.
 *
 *   pnpm --filter @gateway/server dev
 *   pnpm --filter @gateway/server client -- "Add a hover transition to the hero button"
 *
 * GATEWAY_URL defaults to http://127.0.0.1:4100.
 * GATEWAY_CWD defaults to the current working directory.
 * GATEWAY_PROVIDER selects a provider. When unset, antigravity is preferred,
 * then cursor, then any other CLI the gateway detected.
 */

const baseUrl = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');

interface ProviderStatus {
  provider: string;
  available: boolean;
  binaryPath: string | null;
}

interface HealthResponse {
  status: string;
  timestamp: number;
  availableProviders: ProviderStatus[];
}

interface SessionCreated {
  sessionId: string;
  status: string;
  streamUrl: string;
}

interface StreamEvent {
  type: string;
  payload?: {
    text?: string;
    toolName?: string;
    filePath?: string;
    error?: string;
    durationMs?: number;
  };
}

async function main(): Promise<void> {
  const health = await getJson<HealthResponse>('/health');
  if (health.status !== 'ok' || !Array.isArray(health.availableProviders)) {
    throw new Error('Gateway health check did not return provider status');
  }
  const provider = chooseProvider(health.availableProviders);
  const cwd = process.env.GATEWAY_CWD ?? process.cwd();
  const prompt = process.argv.slice(2).join(' ').trim() || 'Say hello in one short sentence.';
  console.error(
    `gateway ok at ${baseUrl}; provider ${provider.provider} (${provider.binaryPath ?? 'path unknown'})`,
  );

  const created = await postJson<SessionCreated>('/api/v1/sessions', {
    provider: provider.provider,
    cwd,
    prompt,
    ephemeral: true,
  });
  console.error(`session ${created.sessionId} -> ${created.streamUrl}`);
  let activeId: string | undefined = created.sessionId;
  const onInterrupt = (): void => {
    const sessionId = activeId;
    activeId = undefined;
    if (!sessionId) {
      process.exit(130);
      return;
    }
    void fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, { method: 'DELETE' }).finally(() => {
      process.exit(130);
    });
  };
  process.on('SIGINT', onInterrupt);

  const response = await fetch(`${baseUrl}${created.streamUrl}`);
  if (!response.ok || !response.body) {
    throw new Error(`SSE subscribe failed (${response.status})`);
  }

  let sawError = false;
  let endedWithNewline = true;
  await readSse(response, (eventName, data) => {
    const event = JSON.parse(data) as StreamEvent;
    if (eventName === 'chunk' && event.payload?.text) {
      process.stdout.write(event.payload.text);
      endedWithNewline = event.payload.text.endsWith('\n');
      return;
    }
    if (eventName === 'tool_call') {
      console.error(`\n[tool] ${event.payload?.toolName ?? 'tool'}`);
    } else if (eventName === 'file_edit' && event.payload?.filePath) {
      console.error(`\n[file] ${event.payload.filePath}`);
    } else if (eventName === 'error') {
      sawError = true;
      console.error(`\n[error] ${event.payload?.error ?? 'error'}`);
    } else if (eventName === 'done') {
      console.error(`\n[done] ${event.payload?.durationMs ?? 0}ms`);
    }
  });
  if (!endedWithNewline) process.stdout.write('\n');
  process.off('SIGINT', onInterrupt);
  process.exit(sawError ? 1 : 0);
}

function chooseProvider(providers: ProviderStatus[]): ProviderStatus {
  const requested = process.env.GATEWAY_PROVIDER?.trim();
  if (requested) {
    const match = providers.find((item) => item.provider === requested);
    if (!match?.available) {
      throw new Error(
        `Provider "${requested}" is not available. Detected: ${providers
          .map((item) => `${item.provider}=${item.available ? item.binaryPath : 'missing'}`)
          .join(', ')}`,
      );
    }
    return match;
  }
  const preferred = ['antigravity', 'cursor'];
  for (const name of preferred) {
    const match = providers.find((item) => item.provider === name && item.available);
    if (match) return match;
  }
  const any = providers.find((item) => item.available);
  if (!any) {
    throw new Error('No CLI provider is available. Install agy or the Cursor agent CLI.');
  }
  return any;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `${path} returned ${response.status}`);
  }
  return payload;
}

async function readSse(
  response: Response,
  onEvent: (eventName: string, data: string) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) deliverBlock(block, onEvent);
  }
  if (buffer.trim()) deliverBlock(buffer, onEvent);
}

function deliverBlock(block: string, onEvent: (eventName: string, data: string) => void): void {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length > 0) onEvent(eventName, dataLines.join('\n'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
