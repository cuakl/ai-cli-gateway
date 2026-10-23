export interface InferCurlInput {
  origin: string;
  prompt: string;
  provider?: string;
  model?: string;
  jsonSchema?: unknown;
  stream?: boolean;
}

/** Equivalent `curl` for the playground request. The token is always `$AIDEV_TOKEN`. */
export function inferCurl(input: InferCurlInput): string {
  const origin = input.origin.replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: input.prompt }],
    stream: input.stream !== false,
  };
  if (input.provider) body.provider = input.provider;
  if (input.model) body.model = input.model;
  if (input.jsonSchema !== undefined) body.jsonSchema = input.jsonSchema;
  const payload = JSON.stringify(body);
  return [
    `curl -sN ${origin}/api/v1/infer \\`,
    `  -H "authorization: Bearer $AIDEV_TOKEN" \\`,
    `  -H "content-type: application/json" \\`,
    `  -H "accept: text/event-stream" \\`,
    `  -d ${shellSingleQuote(payload)}`,
  ].join('\n');
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
