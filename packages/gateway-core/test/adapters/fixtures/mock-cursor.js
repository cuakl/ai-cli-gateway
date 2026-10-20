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
if (!args.includes('-p') && !args.includes('--print')) fail('expected -p');
if (flagValue(args, '--output-format') !== 'json') fail('expected json output');
flagValue(args, '--workspace');
if (!args.includes('--force') && !args.includes('--yolo')) fail('expected --force or --yolo');

const payload = {
  type: 'result',
  message: 'Updated hero button',
  files: ['src/components/Hero.tsx'],
  changes: [{ path: 'src/components/Hero.tsx' }, { path: 'src/App.tsx' }],
  durationMs: 120,
  costUsd: 0.003,
};

process.stdout.write('cursor status\n');
process.stdout.write(`${JSON.stringify(payload)}\n`);
