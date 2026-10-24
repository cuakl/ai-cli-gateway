import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AidevConfigSchema,
  ContextSummarySchema,
  GatewayClientMessageSchema,
  FrontendContextPayloadSchema,
  InferRequestSchema,
  InferResponseSchema,
  OpenAIChatCompletionRequestSchema,
  OpenEditorRequestSchema,
  ProjectRegisterRequestSchema,
  ProjectRegisterResponseSchema,
  ProjectSchema,
  PromptOptionsSchema,
  PromptRequestSchema,
  ProviderCapabilitiesSchema,
  ProviderSchema,
  RestoreRunRequestSchema,
  RestoreRunResponseSchema,
  RunModeSchema,
  RunSchema,
  ThreadEventSchema,
  ThreadSchema,
  UnifiedStreamEventSchema,
  WorkspaceClientMessageSchema,
  WorkspaceServerMessageSchema,
  createStreamEvent,
} from '../src/index.js';

const context = {
  recentErrors: [],
  recentConsoleLogs: [],
  failedNetworkRequests: [],
};

const summary = {
  selections: [
    {
      tagName: 'button',
      id: 'hero-btn',
      componentName: 'Hero',
      fileName: 'src/components/Hero.tsx',
      lineNumber: 11,
    },
  ],
  errorCount: 3,
  logCount: 1,
  failedRequestCount: 1,
  screenshotAttached: true,
};

const project = {
  id: '8f3a',
  root: '/work/app',
  name: 'app',
  origins: ['http://127.0.0.1:5173'],
  createdAt: 1,
  lastSeenAt: 2,
};

const thread = {
  id: 'thr_abc',
  projectId: '8f3a',
  provider: 'cursor',
  model: 'gpt-5',
  mode: 'agent',
  providerSessionId: 'chat_1',
  title: 'Make the button purple',
  createdAt: 1,
  updatedAt: 2,
  keep: true,
  source: 'overlay',
};

const run = {
  id: 'run_abc',
  threadId: 'thr_abc',
  prompt: 'Make the button purple',
  contextSummary: summary,
  attachments: [{ kind: 'image', path: '/tmp/n.png', mime: 'image/png' }],
  status: 'succeeded',
  startedAt: 1,
  endedAt: 2,
  checkpoint: { ref: 'refs/aidev/checkpoints/run_abc', baseHead: 'abc123', dirtyBefore: [] },
  filesTouched: ['src/components/Hero.tsx'],
  error: null,
  usage: { durationMs: 10, inputTokens: 1, outputTokens: 2 },
};

const diffSummary = {
  branch: 'main',
  files: [
    {
      path: 'src/components/Hero.tsx',
      status: 'modified',
      additions: 1,
      deletions: 1,
    },
  ],
  insertions: 1,
  deletions: 1,
};

const streamEvent = {
  id: 'evt_1',
  sessionId: 'sess_1',
  type: 'chunk',
  timestamp: 1,
  payload: { text: 'Hello', segment: 0 },
};

interface Sample {
  name: string;
  schema: z.ZodTypeAny;
  valid: unknown;
  invalid: unknown;
  /** Workspace direction, when this sample is a socket message. */
  wire?: 'client' | 'server';
}

const samples: Sample[] = [
  {
    name: 'Provider',
    schema: ProviderSchema,
    valid: 'cursor',
    invalid: 'gpt',
  },
  {
    name: 'RunMode',
    schema: RunModeSchema,
    valid: 'ask',
    invalid: 'edit',
  },
  {
    name: 'ProviderCapabilities',
    schema: ProviderCapabilitiesSchema,
    valid: {
      provider: 'claude',
      available: true,
      binaryPath: '/usr/local/bin/claude',
      version: '2.1.173',
      verified: true,
      modes: ['agent', 'ask', 'plan'],
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      supportsResume: true,
      supportsImages: true,
      supportsJsonSchema: true,
      supportsSystemPrompt: true,
      setup: ['Run claude and finish sign-in.'],
    },
    invalid: {
      provider: 'claude',
      available: true,
      version: null,
      verified: false,
      modes: ['agent'],
      models: [],
      supportsResume: false,
      supportsImages: false,
      supportsJsonSchema: false,
      supportsSystemPrompt: false,
    },
  },
  {
    name: 'Project',
    schema: ProjectSchema,
    valid: project,
    invalid: { ...project, name: '' },
  },
  {
    name: 'ContextSummary',
    schema: ContextSummarySchema,
    valid: summary,
    invalid: { ...summary, errorCount: -1 },
  },
  {
    name: 'Thread',
    schema: ThreadSchema,
    valid: thread,
    invalid: { ...thread, id: 'sess_abc' },
  },
  {
    name: 'Run',
    schema: RunSchema,
    valid: run,
    invalid: { ...run, status: 'completed' },
  },
  {
    name: 'ThreadEvent',
    schema: ThreadEventSchema,
    valid: { runId: 'run_abc', event: streamEvent },
    invalid: { runId: 'sess_abc', event: streamEvent },
  },
  {
    name: 'project registration request',
    schema: ProjectRegisterRequestSchema,
    valid: { root: '/work/app', origin: 'http://127.0.0.1:5173', allowRemoteShell: false },
    invalid: { root: '/work/app' },
  },
  {
    name: 'project registration response',
    schema: ProjectRegisterResponseSchema,
    valid: { projectId: '8f3a', browserToken: 'browser_token' },
    invalid: { projectId: '8f3a', browserToken: '' },
  },
  {
    name: 'config file',
    schema: AidevConfigSchema,
    valid: {
      port: 4100,
      projects: [project],
      inferenceTokens: ['inf_token'],
      retentionDays: 7,
      defaultProvider: 'cursor',
      defaultModel: 'gpt-5',
      maxConcurrentRuns: 4,
      editor: 'auto',
    },
    invalid: { port: 0 },
  },
  {
    name: 'open editor request',
    schema: OpenEditorRequestSchema,
    valid: { file: 'src/components/Hero.tsx', line: 11, column: 4 },
    invalid: { file: '' },
  },
  {
    name: 'legacy chunk',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_old',
      sessionId: 'sess_1',
      type: 'chunk',
      timestamp: 1,
      payload: { text: 'Hello' },
    },
    invalid: {
      id: 'evt_old',
      sessionId: 'sess_1',
      type: 'nope',
      timestamp: 1,
      payload: {},
    },
  },
  {
    name: 'legacy tool_call',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_tool',
      sessionId: 'sess_1',
      type: 'tool_call',
      timestamp: 1,
      payload: { toolName: 'Edit', toolArgs: { file: 'src/Hero.tsx' } },
    },
    invalid: {
      id: 'evt_tool',
      sessionId: 'sess_1',
      type: 'tool_call',
      timestamp: 1,
      payload: { toolCallId: '' },
    },
  },
  {
    name: 'tool_call with toolCallId',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_tool',
      sessionId: 'sess_1',
      type: 'tool_call',
      timestamp: 1,
      payload: { toolName: 'Edit', toolCallId: 'call_1' },
    },
    invalid: {
      id: 'evt_tool',
      sessionId: 'sess_1',
      type: 'tool_result',
      timestamp: 1,
      payload: { toolCallId: 1 },
    },
  },
  {
    name: 'chunk segment',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_seg',
      sessionId: 'sess_1',
      type: 'chunk',
      timestamp: 1,
      payload: { text: 'Already modified.', segment: -1 },
    },
    invalid: {
      id: 'evt_seg',
      sessionId: 'sess_1',
      type: 'chunk',
      timestamp: 1,
      payload: { text: 'Hi', segment: 1.5 },
    },
  },
  {
    name: 'session_info',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_session',
      sessionId: 'sess_1',
      type: 'session_info',
      timestamp: 1,
      payload: { providerSessionId: 'chat_1', model: 'sonnet' },
    },
    invalid: {
      id: 'evt_session',
      sessionId: 'sess_1',
      type: 'session_info',
      timestamp: 1,
      payload: { providerSessionId: 1, model: 'sonnet' },
    },
  },
  {
    name: 'checkpoint',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_cp',
      sessionId: 'sess_1',
      type: 'checkpoint',
      timestamp: 1,
      payload: { ref: 'refs/aidev/checkpoints/run_abc' },
    },
    invalid: {
      id: 'evt_cp',
      sessionId: 'sess_1',
      type: 'checkpoint',
      timestamp: 1,
      payload: { ref: 1 },
    },
  },
  {
    name: 'files_changed',
    schema: UnifiedStreamEventSchema,
    valid: {
      id: 'evt_files',
      sessionId: 'sess_1',
      type: 'files_changed',
      timestamp: 1,
      payload: { files: ['src/components/Hero.tsx'] },
    },
    invalid: {
      id: 'evt_files',
      sessionId: 'sess_1',
      type: 'files_changed',
      timestamp: 1,
      payload: { files: 'src/components/Hero.tsx' },
    },
  },
  {
    name: 'prompt request',
    schema: PromptRequestSchema,
    valid: { provider: 'cursor', cwd: '/work/app', prompt: 'Hi' },
    invalid: { provider: 'cursor', cwd: '/work/app', prompt: '' },
  },
  {
    name: 'infer request',
    schema: InferRequestSchema,
    valid: {
      provider: 'cursor',
      model: 'gpt-5',
      system: 'Be brief',
      messages: [
        { role: 'system', content: 'Stay in JSON' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Name a color' },
      ],
      jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
      images: [{ dataUrl: 'data:image/png;base64,aaa' }, { path: '/tmp/n.png' }],
      stream: false,
      timeoutMs: 30_000,
      keep: false,
    },
    invalid: { messages: [] },
  },
  {
    name: 'openai chat completion request',
    schema: OpenAIChatCompletionRequestSchema,
    valid: {
      model: 'cursor/gpt-5',
      messages: [
        { role: 'system', content: 'Be brief' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What color?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
          ],
        },
      ],
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'product', schema: { type: 'object' } },
      },
    },
    invalid: { messages: [] },
  },
  {
    name: 'infer response',
    schema: InferResponseSchema,
    valid: {
      id: 'run_abc',
      provider: 'cursor',
      model: 'gpt-5',
      text: 'pong',
      durationMs: 12,
      threadId: 'thr_abc',
      object: { name: 'Lamp' },
    },
    invalid: { id: 'run_abc', provider: 'cursor', text: 'pong' },
  },
  {
    name: 'gateway client prompt',
    schema: GatewayClientMessageSchema,
    valid: { type: 'prompt', provider: 'claude', cwd: '/work/app', prompt: 'Hi' },
    invalid: { type: 'cancel' },
  },
  {
    name: 'run.start',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: {
      type: 'run.start',
      requestId: 'req_1',
      provider: 'cursor',
      mode: 'agent',
      prompt: 'Make the button purple',
      context,
      attachments: [],
    },
    invalid: {
      type: 'run.start',
      provider: 'cursor',
      mode: 'edit',
      prompt: 'Make the button purple',
      context,
      attachments: [],
    },
  },
  {
    name: 'run.cancel',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'run.cancel', runId: 'run_abc' },
    invalid: { type: 'run.cancel', runId: 'sess_abc' },
  },
  {
    name: 'run.attach',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'run.attach', runId: 'run_abc' },
    invalid: { type: 'run.attach' },
  },
  {
    name: 'thread.list',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'thread.list' },
    invalid: { type: 'thread.list', requestId: 1 },
  },
  {
    name: 'thread.get',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'thread.get', threadId: 'thr_abc' },
    invalid: { type: 'thread.get' },
  },
  {
    name: 'thread.delete',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'thread.delete', threadId: 'thr_abc' },
    invalid: { type: 'thread.delete', threadId: '' },
  },
  {
    name: 'thread.keep',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'thread.keep', threadId: 'thr_abc', keep: false },
    invalid: { type: 'thread.keep', threadId: 'thr_abc', keep: 'yes' },
  },
  {
    name: 'git.status',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.status' },
    invalid: { type: 'git.status', requestId: '' },
  },
  {
    name: 'git.diff',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.diff', paths: ['src/components/Hero.tsx'] },
    invalid: { type: 'git.diff', paths: [1] },
  },
  {
    name: 'git.commit',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.commit', message: 'feat: purple button', paths: ['src/Hero.tsx'], push: false },
    invalid: { type: 'git.commit', message: '', paths: [], push: false },
  },
  {
    name: 'git.discard',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.discard', paths: ['src/Hero.tsx'] },
    invalid: { type: 'git.discard' },
  },
  {
    name: 'git.checkpoint.restore',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.checkpoint.restore', runId: 'run_abc', force: true },
    invalid: { type: 'git.checkpoint.restore', runId: 'thr_abc' },
  },
  {
    name: 'RestoreRunRequest',
    schema: RestoreRunRequestSchema,
    valid: { force: false },
    invalid: { force: 'yes' },
  },
  {
    name: 'RestoreRunResponse',
    schema: RestoreRunResponseSchema,
    valid: { runId: 'run_abc', files: ['src/Hero.tsx'] },
    invalid: { runId: 'run_abc' },
  },
  {
    name: 'git.log',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.log', limit: 20 },
    invalid: { type: 'git.log', limit: 0 },
  },
  {
    name: 'git.branch.create',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.branch.create', name: 'aidev/purple-button' },
    invalid: { type: 'git.branch.create', name: '' },
  },
  {
    name: 'git.pr.create',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.pr.create', title: 'Purple button', body: '', base: 'main' },
    invalid: { type: 'git.pr.create', body: '', base: 'main' },
  },
  {
    name: 'git.discard.hunk',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.discard.hunk', path: 'src/Hero.tsx', hunkIndex: 1 },
    invalid: { type: 'git.discard.hunk', path: 'src/Hero.tsx', hunkIndex: -1 },
  },
  {
    name: 'git.commit.undo',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'git.commit.undo' },
    invalid: { type: 'git.commit.undo', requestId: '' },
  },
  {
    name: 'pty.spawn',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'pty.spawn', cols: 80, rows: 24 },
    invalid: { type: 'pty.spawn', cols: 0, rows: 24 },
  },
  {
    name: 'pty.input',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'pty.input', sessionId: 'pty_1', data: 'ls\n' },
    invalid: { type: 'pty.input', sessionId: 'pty_1' },
  },
  {
    name: 'pty.resize',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'pty.resize', sessionId: 'pty_1', cols: 100, rows: 40 },
    invalid: { type: 'pty.resize', sessionId: 'pty_1', cols: 100 },
  },
  {
    name: 'pty.dispose',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'pty.dispose', sessionId: 'pty_1' },
    invalid: { type: 'pty.dispose' },
  },
  {
    name: 'test.run',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: {
      type: 'test.run',
      file: 'src/a.test.ts',
      watch: false,
      testNamePattern: 'Hero',
      onlyFailed: true,
    },
    invalid: { type: 'test.run', watch: 'yes' },
  },
  {
    name: 'test.stop',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'test.stop' },
    invalid: { type: 'test.stop', requestId: null },
  },
  {
    name: 'commit.suggest',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'commit.suggest', paths: ['src/Hero.tsx'] },
    invalid: { type: 'commit.suggest' },
  },
  {
    name: 'files.search',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'files.search', query: 'Hero', limit: 20 },
    invalid: { type: 'files.search', query: 'Hero', limit: 51 },
  },
  {
    name: 'editor.open',
    schema: WorkspaceClientMessageSchema,
    wire: 'client',
    valid: { type: 'editor.open', file: 'src/Hero.tsx', line: 11, column: 4 },
    invalid: { type: 'editor.open', file: '' },
  },
  {
    name: 'run.accepted',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'run.accepted', requestId: 'req_1', threadId: 'thr_abc', runId: 'run_abc' },
    invalid: { type: 'run.accepted', threadId: 'thr_abc' },
  },
  {
    name: 'run.event',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'run.event', runId: 'run_abc', event: streamEvent },
    invalid: { type: 'run.event', runId: 'run_abc', event: { type: 'chunk' } },
  },
  {
    name: 'run.finished',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'run.finished', run },
    invalid: { type: 'run.finished', run: { id: 'run_abc' } },
  },
  {
    name: 'project.activity',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'project.activity', activeRuns: 1, queuedRuns: 2 },
    invalid: { type: 'project.activity', activeRuns: -1 },
  },
  {
    name: 'git.changed',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.changed', summary: diffSummary },
    invalid: { type: 'git.changed' },
  },
  {
    name: 'pty.data',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'pty.data', sessionId: 'pty_1', data: 'ok\r\n' },
    invalid: { type: 'pty.data', sessionId: 'pty_1' },
  },
  {
    name: 'pty.exit',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'pty.exit', sessionId: 'pty_1', code: 0 },
    invalid: { type: 'pty.exit', sessionId: 'pty_1', code: 1.5 },
  },
  {
    name: 'test.output',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'test.output', line: '✓ Hero' },
    invalid: { type: 'test.output', line: 1 },
  },
  {
    name: 'test.finished',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: {
      type: 'test.finished',
      status: 'failed',
      summary: { passed: 1, failed: 1, skipped: 0, durationMs: 12 },
      report: {
        summary: { passed: 1, failed: 1, skipped: 0, durationMs: 12 },
        files: [
          {
            path: 'src/a.test.ts',
            status: 'failed',
            tests: [
              {
                name: 'adds',
                fullName: 'math adds',
                status: 'failed',
                durationMs: 3,
                failureMessages: ['expected 2'],
                location: { line: 4, column: 2 },
              },
            ],
          },
        ],
      },
    },
    invalid: { type: 'test.finished', status: 'error', summary: {} },
  },
  {
    name: 'thread.list.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'thread.list.result', threads: [{ ...thread, runCount: 2 }] },
    invalid: { type: 'thread.list.result', threads: {} },
  },
  {
    name: 'thread.get.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: {
      type: 'thread.get.result',
      thread,
      runs: [run],
      events: [{ runId: 'run_abc', event: streamEvent }],
    },
    invalid: { type: 'thread.get.result', thread, runs: [run] },
  },
  {
    name: 'thread.delete.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'thread.delete.result', threadId: 'thr_abc' },
    invalid: { type: 'thread.delete.result', threadId: 'nope' },
  },
  {
    name: 'thread.keep.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'thread.keep.result', thread: { ...thread, keep: false } },
    invalid: { type: 'thread.keep.result' },
  },
  {
    name: 'git.status.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: {
      type: 'git.status.result',
      status: {
        branch: 'main',
        clean: false,
        conflicted: [],
        dirty: ['src/Hero.tsx'],
        ahead: 1,
        behind: 0,
        ghAvailable: true,
      },
    },
    invalid: { type: 'git.status.result', status: { branch: 'main' } },
  },
  {
    name: 'git.diff.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.diff.result', summary: diffSummary },
    invalid: { type: 'git.diff.result', summary: { files: [] } },
  },
  {
    name: 'git.commit.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.commit.result', commitHash: 'abc123', branch: 'main', pushed: false },
    invalid: { type: 'git.commit.result', commitHash: '', branch: 'main', pushed: false },
  },
  {
    name: 'git.discard.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.discard.result', paths: ['src/Hero.tsx'] },
    invalid: { type: 'git.discard.result' },
  },
  {
    name: 'git.checkpoint.restore.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.checkpoint.restore.result', runId: 'run_abc', files: ['src/Hero.tsx'] },
    invalid: { type: 'git.checkpoint.restore.result', runId: 'run_abc' },
  },
  {
    name: 'git.log.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: {
      type: 'git.log.result',
      commits: [{ hash: 'abc123', subject: 'feat: purple button', at: 1, pushed: false }],
    },
    invalid: { type: 'git.log.result', commits: [{ hash: '', subject: 'x', at: 1 }] },
  },
  {
    name: 'git.branch.create.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.branch.create.result', name: 'aidev/purple-button' },
    invalid: { type: 'git.branch.create.result', name: '' },
  },
  {
    name: 'git.pr.create.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.pr.create.result', url: 'https://github.com/acme/app/pull/1' },
    invalid: { type: 'git.pr.create.result', url: '' },
  },
  {
    name: 'git.discard.hunk.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.discard.hunk.result', path: 'src/Hero.tsx', hunkIndex: 0 },
    invalid: { type: 'git.discard.hunk.result', path: 'src/Hero.tsx', hunkIndex: 1.5 },
  },
  {
    name: 'git.commit.undo.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'git.commit.undo.result', hash: 'abc123' },
    invalid: { type: 'git.commit.undo.result', hash: '' },
  },
  {
    name: 'pty.spawn.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'pty.spawn.result', sessionId: 'pty_1', fallback: false },
    invalid: { type: 'pty.spawn.result', sessionId: 'pty_1' },
  },
  {
    name: 'commit.suggest.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'commit.suggest.result', message: 'feat: purple button' },
    invalid: { type: 'commit.suggest.result', message: '' },
  },
  {
    name: 'files.search.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'files.search.result', files: ['src/Hero.tsx'] },
    invalid: { type: 'files.search.result' },
  },
  {
    name: 'editor.open.result',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'editor.open.result', file: 'src/Hero.tsx' },
    invalid: { type: 'editor.open.result' },
  },
  {
    name: 'error',
    schema: WorkspaceServerMessageSchema,
    wire: 'server',
    valid: { type: 'error', requestId: 'req_1', code: 'path_escape', message: 'outside the project' },
    invalid: { type: 'error', code: '', message: 'outside the project' },
  },
];

function messageType(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string') {
    return value.type;
  }
  throw new Error('sample is missing type');
}

function schemaTypes(schema: z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>): string[] {
  return schema.options.map((option) => {
    const typeField = option.shape.type;
    if (!(typeField instanceof z.ZodLiteral)) throw new Error('discriminator is not a literal');
    return String(typeField.value);
  });
}

describe('protocol schemas', () => {
  it.each(samples)('round-trips $name', ({ schema, valid }) => {
    expect(schema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each(samples)('rejects an invalid $name', ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('accepts an empty config and null run fields', () => {
    expect(AidevConfigSchema.parse({})).toEqual({});
    expect(AidevConfigSchema.parse({ editor: 'cursor' }).editor).toBe('cursor');
    expect(AidevConfigSchema.safeParse({ editor: '' }).success).toBe(false);
    const search = WorkspaceClientMessageSchema.parse({ type: 'files.search', query: 'Hero' });
    expect(search.type).toBe('files.search');
    if (search.type === 'files.search') expect(search.limit).toBeUndefined();
    const open = {
      ...run,
      contextSummary: null,
      endedAt: null,
      checkpoint: null,
      error: null,
      usage: null,
      attachments: [],
      filesTouched: [],
      status: 'running',
    };
    expect(RunSchema.parse(open)).toEqual(open);
    expect(ThreadSchema.parse({ ...thread, projectId: null, model: null, providerSessionId: null })).toEqual({
      ...thread,
      projectId: null,
      model: null,
      providerSessionId: null,
    });
    expect(
      UnifiedStreamEventSchema.parse({
        id: 'evt_session',
        sessionId: 'sess_1',
        type: 'session_info',
        timestamp: 1,
        payload: { providerSessionId: 'chat_1', model: null },
      }).payload.model,
    ).toBeNull();
    expect(
      ProviderCapabilitiesSchema.parse({
        provider: 'codex',
        available: false,
        binaryPath: null,
        version: null,
        verified: false,
        modes: [],
        models: [],
        supportsResume: false,
        supportsImages: false,
        supportsJsonSchema: false,
        supportsSystemPrompt: false,
      }).binaryPath,
    ).toBeNull();
  });

  it('accepts mode, model, providerSessionId, and jsonSchema on prompt options', () => {
    expect(
      PromptOptionsSchema.parse({
        prompt: 'Hi',
        cwd: '/work/app',
        mode: 'plan',
        model: 'sonnet',
        providerSessionId: 'chat_1',
        systemPrompt: 'Be brief',
        ephemeral: true,
        jsonSchema: { type: 'object' },
      }),
    ).toMatchObject({
      mode: 'plan',
      model: 'sonnet',
      providerSessionId: 'chat_1',
      systemPrompt: 'Be brief',
      ephemeral: true,
      jsonSchema: { type: 'object' },
    });
    expect(PromptOptionsSchema.parse({ prompt: 'Hi', cwd: '/work/app' }).mode).toBeUndefined();
    expect(() => PromptOptionsSchema.parse({ prompt: 'Hi', cwd: '/work/app', mode: 'edit' })).toThrow();
    expect(() =>
      PromptOptionsSchema.parse({ prompt: 'Hi', cwd: '/work/app', providerSessionId: '' }),
    ).toThrow();
    expect(InferRequestSchema.safeParse({ messages: [{ role: 'assistant', content: 'Hi' }] }).success).toBe(
      false,
    );
  });

  it('builds a session_info event through createStreamEvent', () => {
    const event = createStreamEvent('sess_1', 'session_info', {
      providerSessionId: 'chat_1',
      model: 'sonnet',
    });
    expect(UnifiedStreamEventSchema.parse(event)).toEqual(event);
    expect(event.payload.providerSessionId).toBe('chat_1');
  });

  it('covers every workspace message type once', () => {
    for (const wire of ['client', 'server'] as const) {
      const schema = wire === 'client' ? WorkspaceClientMessageSchema : WorkspaceServerMessageSchema;
      const fromSamples = samples.filter((sample) => sample.wire === wire).map((sample) => messageType(sample.valid));
      expect(schemaTypes(schema).sort()).toEqual([...fromSamples].sort());
    }
  });

  it('rejects a message on the wrong side of the socket', () => {
    expect(WorkspaceServerMessageSchema.safeParse({ type: 'git.status' }).success).toBe(false);
    expect(
      WorkspaceClientMessageSchema.safeParse({
        type: 'run.accepted',
        threadId: 'thr_abc',
        runId: 'run_abc',
      }).success,
    ).toBe(false);
  });

  it('defaults context arrays so non-overlay clients can omit them', () => {
    expect(FrontendContextPayloadSchema.parse({})).toEqual({
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    });
    expect(
      FrontendContextPayloadSchema.parse({
        selectedElement: {
          tagName: 'button',
          id: 'hero-btn',
          className: 'btn',
          outerHTML: '<button></button>',
          computedStyles: {},
        },
      }),
    ).toMatchObject({
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    });
    const started = WorkspaceClientMessageSchema.parse({
      type: 'run.start',
      provider: 'cursor',
      mode: 'ask',
      prompt: 'Where is this styled?',
      attachments: [{ kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,aaa' }],
    });
    expect(started).toMatchObject({
      type: 'run.start',
      context: { recentErrors: [], recentConsoleLogs: [], failedNetworkRequests: [] },
      attachments: [{ kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,aaa' }],
    });
    expect(InferRequestSchema.parse({ messages: [{ role: 'user', content: 'Hi' }] }).images).toBeUndefined();
  });

  it('accepts up to five selectedElements and keeps selectedElement for compat', () => {
    const element = (id: string) => ({
      tagName: 'strong',
      id,
      className: '',
      outerHTML: `<strong id="${id}"></strong>`,
      computedStyles: {},
    });
    const parsed = FrontendContextPayloadSchema.parse({
      selectedElement: element('one'),
      selectedElements: [element('one'), element('two')],
    });
    expect(parsed.selectedElement?.id).toBe('one');
    expect(parsed.selectedElements?.map((item) => item.id)).toEqual(['one', 'two']);
    expect(
      FrontendContextPayloadSchema.safeParse({
        selectedElements: ['a', 'b', 'c', 'd', 'e', 'f'].map(element),
      }).success,
    ).toBe(false);
    expect(
      FrontendContextPayloadSchema.parse({
        selectedElements: ['a', 'b', 'c', 'd', 'e'].map(element),
      }).selectedElements,
    ).toHaveLength(5);
  });
});
