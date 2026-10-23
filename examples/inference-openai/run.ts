/**
 * Official `openai` package against the gateway's OpenAI-compatible façade.
 *
 *   pnpm --filter @aidev/gateway dev
 *   pnpm --filter @aidev/example-inference-openai start
 *
 * baseURL defaults to http://127.0.0.1:4100/v1.
 * apiKey is AIDEV_TOKEN or the machine token at $AIDEV_HOME/token.
 *
 * Usage counters on this endpoint are zeros (the CLI does not report tokens).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'tags'],
};

async function main(): Promise<void> {
  const openai = new OpenAI({
    baseURL: (process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:4100/v1').replace(/\/$/, ''),
    apiKey: readToken(),
  });
  const model = process.env.AIDEV_MODEL ?? 'cursor';
  const mode = process.argv[2] ?? 'all';

  if (mode === 'all' || mode === 'generate') {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    });
    console.log('non-stream:', completion.choices[0]?.message.content?.trim() ?? '');
    console.log('usage:', JSON.stringify(completion.usage));
  }

  if (mode === 'all' || mode === 'stream') {
    const stream = await openai.chat.completions.create({
      model,
      stream: true,
      messages: [{ role: 'user', content: 'Say hello in five words.' }],
    });
    process.stdout.write('stream: ');
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
    }
    process.stdout.write('\n');
  }

  if (mode === 'all' || mode === 'object') {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Invent a small desk lamp. Return name and tags.' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'product', schema: PRODUCT_SCHEMA },
      },
    });
    console.log('json_schema:', completion.choices[0]?.message.content ?? '');
  }
}

function readToken(): string {
  const fromEnv = process.env.AIDEV_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.AIDEV_HOME?.trim()
    ? path.resolve(process.env.AIDEV_HOME.trim())
    : path.join(homedir(), '.aidev');
  try {
    return readFileSync(path.join(home, 'token'), 'utf8').trim();
  } catch {
    throw new Error(`No machine token at ${path.join(home, 'token')}. Start the gateway once, or set AIDEV_TOKEN.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
