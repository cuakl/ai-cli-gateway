#!/usr/bin/env node

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) fail(`missing ${flag}`);
  const value = args[index + 1];
  if (!value || value.startsWith('-')) fail(`missing value for ${flag}`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--print') && !args.includes('-p')) fail('expected --print or -p');
  if (flagValue(args, '--output-format') !== 'stream-json') fail('expected stream-json');
  flagValue(args, '--workspace');
  const prompt = args[1];
  if (!prompt || prompt.startsWith('-')) fail('expected prompt');

  const lines = [
    { type: 'text_delta', text: prompt },
    { type: 'init', session_id: 'agy-chat', text: 'agy session ready' },
    { type: 'text_delta', text: 'Hello ' },
    { type: 'chunk', delta: 'world' },
    'status: writing styles',
    {
      type: 'tool_call',
      toolName: 'Edit',
      toolArgs: { old_string: 'blue', new_string: 'emerald' },
    },
    { type: 'tool_result', toolOutput: 'edited Hero.tsx' },
    { type: 'file_edit', filePath: 'src/Hero.tsx' },
    { type: 'result', durationMs: 42, costUsd: 0.01, text: 'button updated' },
  ];

  for (const line of lines) {
    await delay(15);
    const text = typeof line === 'string' ? line : JSON.stringify(line);
    process.stdout.write(`${text}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
