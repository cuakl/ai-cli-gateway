import type {
  ContextSummary,
  Run,
  RunStatus,
  StreamEventPayload,
  ThreadEvent,
  UnifiedStreamEvent,
} from '@aidev/protocol';

export const RESULT_LIMIT = 2000;

export type ContextChipKind =
  | 'selection'
  | 'screenshot'
  | 'console'
  | 'network'
  | 'vite'
  | 'test';

export interface ContextChip {
  id: string;
  kind: ContextChipKind;
  label: string;
  /** Tooltip / hover preview. */
  preview?: string;
  /** Data URL for a screenshot thumbnail. */
  thumbnail?: string;
}

export interface NoticeAction {
  label: string;
  action: string;
}

export type AssistantStatus = RunStatus | 'done' | 'error';

export interface MarkdownBlock {
  kind: 'markdown';
  text: string;
}

export interface ToolBlock {
  kind: 'tool';
  toolCallId: string;
  name: string;
  label: string;
  target?: string;
  args?: Record<string, unknown>;
  result?: string;
  state: 'running' | 'ok' | 'error';
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface FilesBlock {
  kind: 'files';
  files: ChangedFile[];
}

export type Block = MarkdownBlock | ToolBlock | FilesBlock;

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  chips: ContextChip[];
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  runId: string;
  blocks: Block[];
  status: AssistantStatus;
  durationMs?: number;
  model?: string | null;
  providerSessionId?: string;
  checkpointRef?: string;
  /** Last `chunk.segment` applied as assistant text. */
  lastSegment?: number;
}

export interface NoticeItem {
  kind: 'notice';
  id: string;
  tone: 'info' | 'warning' | 'error';
  text: string;
  actions?: NoticeAction[];
  setup?: string[];
}

export type TurnItem = UserItem | AssistantItem | NoticeItem;

export interface ChatState {
  items: readonly TurnItem[];
}

export type GroupedBlock =
  | { kind: 'block'; block: Block }
  | { kind: 'read-group'; label: string; count: number; blocks: ToolBlock[] };

export const EMPTY_CHAT_STATE: ChatState = { items: [] };

export function emptyChatState(): ChatState {
  return EMPTY_CHAT_STATE;
}

export function startTurn(
  state: ChatState,
  input: { userText: string; chips: ContextChip[]; runId: string },
): ChatState {
  const user: UserItem = {
    kind: 'user',
    id: createId(),
    text: input.userText,
    chips: input.chips,
  };
  const assistant: AssistantItem = {
    kind: 'assistant',
    id: createId(),
    runId: input.runId,
    blocks: [],
    status: 'running',
  };
  return { items: [...state.items, user, assistant] };
}

export function applyEvent(state: ChatState, runId: string, event: UnifiedStreamEvent): ChatState {
  const index = findAssistantIndex(state.items, runId);
  if (index < 0) return state;
  const assistant = state.items[index];
  if (assistant?.kind !== 'assistant') return state;

  switch (event.type) {
    case 'init':
      return state;
    case 'chunk':
      return applyChunk(state, index, assistant, event);
    case 'tool_call':
      return replaceAssistant(state, index, applyToolCall(assistant, event));
    case 'tool_result':
      return replaceAssistant(state, index, applyToolResult(assistant, event));
    case 'file_edit':
      return state;
    case 'error':
      return applyError(state, index, assistant, event);
    case 'session_info':
      return replaceAssistant(state, index, {
        ...assistant,
        ...(event.payload.model !== undefined ? { model: event.payload.model } : {}),
        ...(event.payload.providerSessionId
          ? { providerSessionId: event.payload.providerSessionId }
          : {}),
      });
    case 'checkpoint':
      return event.payload.ref
        ? replaceAssistant(state, index, { ...assistant, checkpointRef: event.payload.ref })
        : state;
    case 'files_changed':
      return replaceAssistant(state, index, applyFilesChanged(assistant, event.payload));
    case 'done':
      return replaceAssistant(state, index, applyDone(assistant, event.payload));
    default:
      return state;
  }
}

export function groupToolBlocks(blocks: readonly Block[]): GroupedBlock[] {
  const grouped: GroupedBlock[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (!block) break;
    if (!isSuccessfulRead(block)) {
      grouped.push({ kind: 'block', block });
      index += 1;
      continue;
    }
    const reads: ToolBlock[] = [block];
    let cursor = index + 1;
    while (cursor < blocks.length) {
      const next = blocks[cursor];
      if (!next || !isSuccessfulRead(next)) break;
      reads.push(next);
      cursor += 1;
    }
    if (reads.length >= 2) {
      grouped.push({
        kind: 'read-group',
        count: reads.length,
        label: `Read ${reads.length} files`,
        blocks: reads,
      });
    } else {
      grouped.push({ kind: 'block', block });
    }
    index = cursor;
  }
  return grouped;
}

export function toolLabel(name: string, args?: Record<string, unknown>): string {
  const key = name.toLowerCase();
  const file = firstString(args, FILE_KEYS);
  const cmd = firstString(args, CMD_KEYS);
  const query = firstString(args, QUERY_KEYS);
  if (isEditTool(key)) return withTarget('Edited', file);
  if (key.includes('read')) return withTarget('Read', file);
  if (key.includes('shell') || key.includes('bash')) return withTarget('Ran', cmd);
  if (key.includes('search') || key.includes('grep') || key.includes('glob')) {
    return withTarget('Searched', query);
  }
  return name;
}

const FILE_KEYS = ['path', 'filePath', 'file_path', 'target_file', 'file'];
const CMD_KEYS = ['cmd', 'command', 'commandLine'];
const QUERY_KEYS = ['q', 'query', 'pattern', 'search', 'glob'];

interface EventExtras {
  args?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  message?: string;
  code?: string;
  setup?: string[];
  status?: AssistantStatus;
}

function applyChunk(
  state: ChatState,
  index: number,
  assistant: AssistantItem,
  event: UnifiedStreamEvent,
): ChatState {
  const segment = event.payload.segment ?? 0;
  const text = event.payload.text ?? '';
  if (segment === -1) {
    if (!text) return state;
    const notice: NoticeItem = {
      kind: 'notice',
      id: createId(),
      tone: 'info',
      text,
    };
    const items = state.items.slice();
    items.splice(index, 0, notice);
    return { items };
  }
  if (!text) return state;
  const blocks = assistant.blocks.slice();
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'markdown' && assistant.lastSegment === segment) {
    blocks[blocks.length - 1] = { kind: 'markdown', text: last.text + text };
  } else {
    blocks.push({ kind: 'markdown', text });
  }
  return replaceAssistant(state, index, { ...assistant, blocks, lastSegment: segment });
}

function applyToolCall(assistant: AssistantItem, event: UnifiedStreamEvent): AssistantItem {
  const payload = event.payload;
  const extras = extrasOf(payload);
  const name = payload.toolName ?? '';
  const args = payload.toolArgs ?? extras.args;
  const toolCallId = payload.toolCallId ?? event.id;
  const target = toolTarget(name, args);
  const block: ToolBlock = {
    kind: 'tool',
    toolCallId,
    name,
    label: toolLabel(name, args),
    state: 'running',
    ...(target ? { target } : {}),
    ...(args ? { args: { ...args } } : {}),
  };
  return { ...assistant, blocks: [...assistant.blocks, block] };
}

function applyToolResult(assistant: AssistantItem, event: UnifiedStreamEvent): AssistantItem {
  const toolCallId = event.payload.toolCallId;
  if (!toolCallId) return assistant;
  const extras = extrasOf(event.payload);
  const index = assistant.blocks.findIndex(
    (block) => block.kind === 'tool' && block.toolCallId === toolCallId,
  );
  if (index < 0) return assistant;
  const current = assistant.blocks[index];
  if (current?.kind !== 'tool') return assistant;
  const raw = event.payload.toolOutput ?? extras.result;
  const blocks = assistant.blocks.slice();
  blocks[index] = {
    ...current,
    state: extras.isError === true ? 'error' : 'ok',
    ...(raw !== undefined ? { result: truncateResult(raw) } : {}),
  };
  return { ...assistant, blocks };
}

function applyFilesChanged(assistant: AssistantItem, payload: StreamEventPayload): AssistantItem {
  const files = parseChangedFiles(payload);
  const block: FilesBlock = { kind: 'files', files };
  const existing = assistant.blocks.findIndex((item) => item.kind === 'files');
  const blocks = assistant.blocks.slice();
  if (existing >= 0) blocks[existing] = block;
  else blocks.push(block);
  return { ...assistant, blocks };
}

function applyDone(assistant: AssistantItem, payload: StreamEventPayload): AssistantItem {
  const extras = extrasOf(payload);
  const status = extras.status ?? (assistant.status === 'error' ? 'error' : 'done');
  const errored = isErrorStatus(status) || assistant.status === 'error';
  const toolState: ToolBlock['state'] = errored ? 'error' : 'ok';
  const blocks = assistant.blocks.map((block) =>
    block.kind === 'tool' && block.state === 'running' ? { ...block, state: toolState } : block,
  );
  return {
    ...assistant,
    blocks,
    status,
    ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
  };
}

function applyError(
  state: ChatState,
  index: number,
  assistant: AssistantItem,
  event: UnifiedStreamEvent,
): ChatState {
  const extras = extrasOf(event.payload);
  const text = event.payload.error ?? extras.message ?? 'The agent reported an error';
  const setup = Array.isArray(extras.setup)
    ? extras.setup.filter((step): step is string => typeof step === 'string')
    : undefined;
  const actions: NoticeAction[] = [{ label: 'Retry', action: 'retry' }];
  if (extras.code === 'provider_unavailable' || extras.code === 'cli_auth_required') {
    actions.push({ label: 'Copy command', action: 'copy-command' });
  }
  const notice: NoticeItem = {
    kind: 'notice',
    id: createId(),
    tone: 'error',
    text,
    actions,
    ...(setup && setup.length > 0 ? { setup } : {}),
  };
  const items = state.items.slice();
  items[index] = { ...assistant, status: 'error' };
  items.splice(index + 1, 0, notice);
  return { items };
}

function parseChangedFiles(payload: StreamEventPayload): ChangedFile[] {
  const files = (payload as StreamEventPayload & { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const parsed: ChangedFile[] = [];
  for (const file of files) {
    if (typeof file === 'string' && file.length > 0) {
      parsed.push({ path: file, additions: 0, deletions: 0 });
      continue;
    }
    if (!file || typeof file !== 'object') continue;
    const record = file as { path?: unknown; additions?: unknown; deletions?: unknown };
    if (typeof record.path !== 'string' || record.path.length === 0) continue;
    parsed.push({
      path: record.path,
      additions: typeof record.additions === 'number' ? record.additions : 0,
      deletions: typeof record.deletions === 'number' ? record.deletions : 0,
    });
  }
  return parsed;
}

function toolTarget(name: string, args?: Record<string, unknown>): string | undefined {
  const key = name.toLowerCase();
  if (key.includes('shell') || key.includes('bash')) return firstString(args, CMD_KEYS);
  if (key.includes('search') || key.includes('grep') || key.includes('glob')) {
    return firstString(args, QUERY_KEYS);
  }
  return firstString(args, FILE_KEYS);
}

function isEditTool(key: string): boolean {
  return (
    key.includes('write') ||
    key.includes('edit') ||
    key.includes('patch') ||
    key.includes('strreplace')
  );
}

function isSuccessfulRead(block: Block): block is ToolBlock {
  return block.kind === 'tool' && block.state === 'ok' && block.name.toLowerCase().includes('read');
}

function isErrorStatus(status: AssistantStatus): boolean {
  return status === 'error' || status === 'failed' || status === 'timeout';
}

function isTerminalRun(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timeout';
}

function withTarget(verb: string, target: string | undefined): string {
  return target ? `${verb} \`${target}\`` : verb;
}

function firstString(args: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function truncateResult(value: string): string {
  return value.length <= RESULT_LIMIT ? value : value.slice(0, RESULT_LIMIT);
}

function extrasOf(payload: StreamEventPayload): EventExtras {
  return payload as StreamEventPayload & EventExtras;
}

function findAssistantIndex(items: readonly TurnItem[], runId: string): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'assistant' && item.runId === runId) return index;
  }
  return -1;
}

function replaceAssistant(state: ChatState, index: number, assistant: AssistantItem): ChatState {
  const current = state.items[index];
  if (current === assistant) return state;
  const items = state.items.slice();
  items[index] = assistant;
  return { items };
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Rebuild a transcript from stored runs and their JSONL events. */
export function hydrateFromThread(runs: readonly Run[], events: readonly ThreadEvent[]): ChatState {
  const byRun = new Map<string, UnifiedStreamEvent[]>();
  for (const entry of events) {
    const list = byRun.get(entry.runId);
    if (list) list.push(entry.event);
    else byRun.set(entry.runId, [entry.event]);
  }
  const ordered = runs.slice().sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  let state = emptyChatState();
  for (const run of ordered) {
    state = startTurn(state, {
      userText: run.prompt,
      chips: chipsFromSummary(run.contextSummary),
      runId: run.id,
    });
    let sawDone = false;
    for (const event of byRun.get(run.id) ?? []) {
      if (event.type === 'done') sawDone = true;
      state = applyEvent(state, run.id, event);
    }
    if (!sawDone && isTerminalRun(run.status)) {
      state = applyEvent(state, run.id, {
        id: `hydrate_done_${run.id}`,
        sessionId: run.threadId,
        type: 'done',
        timestamp: run.endedAt ?? run.startedAt,
        payload: {
          status: run.status,
          ...(run.usage?.durationMs !== undefined ? { durationMs: run.usage.durationMs } : {}),
        } as StreamEventPayload,
      });
    }
  }
  return state;
}

export function chipsFromSummary(summary: ContextSummary | null): ContextChip[] {
  if (!summary) return [];
  const chips: ContextChip[] = [];
  for (const [index, selection] of summary.selections.entries()) {
    const file = selection.fileName?.split(/[/\\]/).pop() ?? selection.fileName;
    const name = selection.componentName ?? selection.tagName;
    const line = selection.lineNumber != null ? `:${selection.lineNumber}` : '';
    chips.push({
      id: `selection:${index}`,
      kind: 'selection',
      label: file ? `${name} · ${file}${line}` : name,
    });
  }
  if (summary.screenshotAttached) {
    chips.push({ id: 'screenshot', kind: 'screenshot', label: 'Screenshot' });
  }
  if (summary.errorCount > 0) {
    chips.push({
      id: 'console',
      kind: 'console',
      label: countLabel(summary.errorCount, 'console error', 'console errors'),
    });
  }
  if (summary.failedRequestCount > 0) {
    chips.push({
      id: 'network',
      kind: 'network',
      label: countLabel(summary.failedRequestCount, 'failed request', 'failed requests'),
    });
  }
  return chips;
}

export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
