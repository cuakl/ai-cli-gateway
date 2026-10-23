# `@aidev/client`

Tiny fetch SDK for the gateway inference API. No runtime dependencies. Talks to `POST /api/v1/infer` on a local `aidev` gateway using a CLI you are already signed into.

Each call starts a CLI process. Cold start is typically several seconds.

```ts
import { createClient } from '@aidev/client';

const ai = createClient(); // AIDEV_URL, AIDEV_TOKEN, or ~/.aidev/token

const { text } = await ai.generate({ prompt: 'Reply with exactly: pong', model: 'cursor' });

for await (const chunk of ai.stream({ prompt: 'Say hello' })) {
  process.stdout.write(chunk);
}

const product = await ai.generateObject({
  prompt: 'Invent a product',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    required: ['name', 'tags'],
  },
});
```

## Options

`createClient({ baseUrl, token })`

| | Default |
| --- | --- |
| `baseUrl` | `AIDEV_URL` or `http://127.0.0.1:4100` |
| `token` | `AIDEV_TOKEN`, else `$AIDEV_HOME/token` (Node only, read on first request) |

`generate` / `stream` / `generateObject` accept `prompt` or `messages`, plus `provider`, `model`, `system`, `images` (`{ dataUrl }` or `{ path }`), and `timeoutMs`.

`generateObject` takes a JSON Schema object, or a Zod schema. Zod is converted with `zod-to-json-schema` when that package is installed; otherwise pass JSON Schema.

Failures throw `AidevClientError` with a `code` (`invalid_structured_output`, `missing_token`, `provider_unavailable`, …).

## OpenAI SDK

The same gateway also serves `POST /v1/chat/completions`. Usage counters are zeros.

```ts
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:4100/v1',
  apiKey: process.env.AIDEV_TOKEN ?? readFileSync(join(homedir(), '.aidev/token'), 'utf8').trim(),
});

const completion = await openai.chat.completions.create({
  model: 'cursor',
  messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
});
```

`model` is `"<provider>/<model>"` (for example `cursor/gpt-5`, `claude/sonnet`), `"<provider>"`, or omitted / `"default"`.
