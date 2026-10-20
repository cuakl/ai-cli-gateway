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
  if (!args.includes('--bare')) fail('expected --bare');
  if (!args.includes('-p') && !args.includes('--print')) fail('expected -p');
  if (flagValue(args, '--output-format') !== 'stream-json') fail('expected stream-json');
  const tools = flagValue(args, '--allowedTools');
  if (!tools.split(',').includes('Read') || !tools.split(',').includes('Edit')) {
    fail('expected Read and Edit in allowed tools');
  }
  if (flagValue(args, '--permission-prompts') !== 'none') fail('expected permission prompts none');

  const events = [
    { type: 'system', subtype: 'init', session_id: 'cli-sess' },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Looking at the button' } },
    {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        name: 'Edit',
        input: { file_path: 'src/App.tsx', old_string: 'a', new_string: 'b' },
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'updated App.tsx' }] } },
    {
      type: 'result',
      subtype: 'success',
      result: 'Updated styles',
      duration_ms: 80,
      total_cost_usd: 0.02,
    },
  ];

  for (const event of events) {
    await delay(10);
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
