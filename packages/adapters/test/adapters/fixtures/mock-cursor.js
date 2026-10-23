#!/usr/bin/env node

/**
 * Stand-in for Cursor agent 2026.10.22-27dcf5f print mode.
 * Unknown flags exit 1 with `error: unknown option '<flag>'`, matching `agent`.
 */

const BOOLEAN_FLAGS = new Set([
  '-p',
  '--print',
  '-f',
  '--force',
  '--yolo',
  '--stream-partial-output',
  '--trust',
]);

const VALUE_FLAGS = new Set(['--output-format', '--workspace', '--mode', '--model', '--resume']);

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

const { values, positionals } = parseArgs(process.argv.slice(2));
if (!values['-p'] && !values['--print']) fail('expected print mode');
if (values['--output-format'] !== 'stream-json') fail('expected stream-json');
if (!values['--stream-partial-output']) fail('expected --stream-partial-output');
if (!values['--trust']) fail('expected --trust');
if (!values['--workspace']) fail('missing --workspace');
const mode = values['--mode'];
if (mode && mode !== 'ask' && mode !== 'plan') fail(`error: option '--mode' value '${mode}' is invalid`);
const force = values['--force'] || values['--yolo'] || values['-f'];
if (!mode && !force) fail('expected --force or --yolo');
const prompt = positionals[0];
if (!prompt) fail('expected the prompt after --');

const sessionId = 'sess';
const lines = [
  "cursor-retrieval: tracing to '/var/folders/xx/cursor_retrieval.log'",
  {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'Auto',
    permissionMode: 'default',
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    session_id: sessionId,
  },
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Updated hero button' }] },
    session_id: sessionId,
  },
  {
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-hero',
    session_id: sessionId,
    tool_call: {
      tool: { case: 'editToolCall', value: { args: { path: 'src/components/Hero.tsx' } } },
    },
  },
  {
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-app',
    session_id: sessionId,
    tool_call: {
      tool: { case: 'writeToolCall', value: { args: { path: 'src/App.tsx' } } },
    },
  },
  { type: 'result', subtype: 'success', duration_ms: 120, result: 'Updated hero button', session_id: sessionId },
];

for (const line of lines) {
  const text = typeof line === 'string' ? line : JSON.stringify(line);
  process.stdout.write(`${text}\n`);
}
