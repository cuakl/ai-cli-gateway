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
  if (args[0] !== 'exec') fail('expected exec');
  if (!args.includes('--jsonl')) fail('expected --jsonl');
  if (flagValue(args, '--sandbox') !== 'workspace-write') fail('expected workspace-write');
  const resumeAt = args.indexOf('resume');
  if (resumeAt !== -1) {
    const sessionId = args[resumeAt + 1];
    if (!sessionId || sessionId.startsWith('-')) fail('resume requires a session id');
  }
  const prompt = args[args.length - 1];
  if (!prompt || prompt.startsWith('-')) fail('expected prompt');

  const events = [
    { type: 'thread.started', thread_id: 'thr_codex', model: 'gpt-5' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Renamed the header' } },
    { type: 'item.started', item: { type: 'command_execution', command: 'ls src' } },
    { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'App.tsx' } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/Header.tsx' }] } },
    { type: 'turn.completed', duration_ms: 55, usage: { cost_usd: 0.004 } },
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
