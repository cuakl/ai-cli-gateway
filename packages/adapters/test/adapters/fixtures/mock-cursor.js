#!/usr/bin/env node

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

const args = process.argv.slice(2);
if (!args.includes('-p') && !args.includes('--print')) fail('expected print mode');
if (flagValue(args, '--output-format') !== 'stream-json') fail('expected stream-json');
if (!args.includes('--stream-partial-output')) fail('expected --stream-partial-output');
if (!args.includes('--trust')) fail('expected --trust');
flagValue(args, '--workspace');
const separator = args.indexOf('--');
if (separator === -1 || !args[separator + 1]) fail('expected the prompt after --');
if (!args.includes('--force') && !args.includes('--yolo')) fail('expected --force or --yolo');

const lines = [
  { type: 'system', subtype: 'init', session_id: 'sess' },
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: args[separator + 1] }] } },
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Updated hero button' }] },
  },
  {
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-hero',
    tool_call: {
      tool: { case: 'editToolCall', value: { args: { path: 'src/components/Hero.tsx' } } },
    },
  },
  {
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-app',
    tool_call: {
      tool: { case: 'writeToolCall', value: { args: { path: 'src/App.tsx' } } },
    },
  },
  { type: 'result', subtype: 'success', duration_ms: 120, result: 'Updated hero button' },
];

for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
