/**
 * generate, stream, and generateObject against a running gateway.
 *
 *   pnpm --filter @aidev/gateway dev
 *   pnpm --filter @aidev/example-inference-node start
 *
 * AIDEV_URL defaults to http://127.0.0.1:4100.
 * AIDEV_TOKEN, or the machine token at $AIDEV_HOME/token (default ~/.aidev/token).
 */
import { createClient } from '@aidev/client';

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'tags'],
} as const;

async function main(): Promise<void> {
  const ai = createClient();
  const mode = process.argv[2] ?? 'all';

  if (mode === 'all' || mode === 'generate') {
    const result = await ai.generate({
      prompt: 'Reply with exactly: pong',
      model: process.env.AIDEV_MODEL ?? 'cursor',
    });
    console.log('generate:', result.text.trim());
  }

  if (mode === 'all' || mode === 'stream') {
    process.stdout.write('stream: ');
    for await (const chunk of ai.stream({
      prompt: 'Say hello in five words.',
      model: process.env.AIDEV_MODEL ?? 'cursor',
    })) {
      process.stdout.write(chunk);
    }
    process.stdout.write('\n');
  }

  if (mode === 'all' || mode === 'object') {
    const product = await ai.generateObject({
      prompt: 'Invent a small desk lamp. Return name and tags.',
      model: process.env.AIDEV_MODEL ?? 'cursor',
      schema: PRODUCT_SCHEMA,
    });
    console.log('generateObject:', JSON.stringify(product));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
