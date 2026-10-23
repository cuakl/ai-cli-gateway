#!/usr/bin/env node

/**
 * Stand-in for Claude Code 2.1.173's agent-mode argv.
 * Unknown flags exit 1 with `error: unknown option '<flag>'`, matching `claude`.
 * `--bare` is a real flag and is accepted, but this fixture does not require it.
 */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BOOLEAN_FLAGS = new Set([
  '--verbose',
  '--include-partial-messages',
  '--bare',
  '--no-session-persistence',
]);
const VALUE_FLAGS = new Set([
  '-p',
  '--print',
  '--output-format',
  '--permission-mode',
  '--allowedTools',
  '--allowed-tools',
  '--model',
  '--append-system-prompt',
  '--resume',
  '-r',
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      values[name] = true;
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
      if (eq === -1) index += 1;
      if (!value || value.startsWith('-')) fail(`error: option '${name}' argument missing`);
      values[name] = value;
      continue;
    }
    fail(`error: unknown option '${name}'`);
  }
  return { values, positionals };
}

async function main() {
  const { values, positionals } = parseArgs(process.argv.slice(2));
  const prompt = values['-p'] || values['--print'] || positionals[0];
  if (!prompt) fail('expected -p');
  if (values['--output-format'] !== 'stream-json') fail('expected stream-json');
  if (!values['--verbose']) fail('expected --verbose');
  if (!values['--include-partial-messages']) fail('expected --include-partial-messages');
  const permission = values['--permission-mode'];
  if (permission !== 'acceptEdits' && permission !== 'plan') fail('expected permission mode acceptEdits or plan');
  const tools = (values['--allowedTools'] || values['--allowed-tools'] || '').split(',');
  if (permission === 'plan') {
    for (const name of ['Read', 'Glob', 'Grep']) {
      if (!tools.includes(name)) fail(`expected ${name} in allowed tools`);
    }
  } else if (!tools.includes('Read') || !tools.includes('Edit')) {
    fail('expected Read and Edit in allowed tools');
  }

  const events = [
    { type: 'system', subtype: 'init', session_id: 'cli-sess' },
    {
      type: 'stream_event',
      event: { type: 'message_start', message: { role: 'assistant', content: [] } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Looking ' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'at the button' } },
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: {} },
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"src/App.tsx"}' },
      },
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
    { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' } } },
    { type: 'stream_event', event: { type: 'message_stop' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking at the button' },
          {
            type: 'tool_use',
            id: 'toolu_edit',
            name: 'Edit',
            input: { file_path: 'src/App.tsx', old_string: 'a', new_string: 'b' },
          },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'updated App.tsx' }] } },
    {
      type: 'result',
      subtype: 'success',
      result: 'Updated styles',
      duration_ms: 80,
      total_cost_usd: 0.02,
      session_id: 'cli-sess',
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
