import type { Principal } from '../auth/principal.js';
import { beginInfer, cleanupInfer, completeInfer } from '../inference/run.js';
import type { ServerDeps } from '../types.js';
import { getDiff, GitOpError } from './git-service.js';

const DIFF_LIMIT = 20 * 1024;

const SYSTEM = [
  'Write a Conventional Commits message for the given diff.',
  'The first line is the subject and must be at most 72 characters.',
  'Add a body after a blank line only when it helps.',
  'Reply with only the commit message. No quotes, no markdown fences, no commentary.',
].join(' ');

/**
 * Draft a commit message from the staged-or-working diff of `paths` and the
 * last few user prompts in the project's newest thread. Always runs in ask
 * mode inside a scratch directory, never in the project tree.
 */
export async function suggestCommitMessage(
  deps: ServerDeps,
  principal: Principal,
  projectRoot: string,
  projectId: string,
  paths: string[],
): Promise<string> {
  const summary = await getDiff(projectRoot, paths.length > 0 ? paths : undefined);
  let diff = summary.raw?.trim() ?? '';
  if (!diff) {
    throw new GitOpError('no_changes', 'There are no changes to describe');
  }
  if (diff.length > DIFF_LIMIT) diff = `${diff.slice(0, DIFF_LIMIT)}\n…`;
  const prompts = await recentThreadPrompts(deps, projectId);
  const setup = await beginInfer(
    deps,
    {
      system: SYSTEM,
      messages: [{ role: 'user', content: buildCommitSuggestPrompt(diff, prompts) }],
    },
    'overlay',
  );
  try {
    const result = await completeInfer(deps, principal, setup);
    if (result.kind !== 'ok') {
      throw new GitOpError('empty_suggestion', 'The model did not return a commit message');
    }
    const message = sanitizeCommitMessage(result.response.text);
    if (!message) {
      throw new GitOpError('empty_suggestion', 'The model did not return a commit message');
    }
    return message;
  } finally {
    await cleanupInfer(setup);
  }
}

/** Last three user prompts of the project's most recently updated thread. */
export async function recentThreadPrompts(deps: ServerDeps, projectId: string): Promise<string[]> {
  const threads = await deps.threads.listThreads({ projectId, limit: 1 });
  const newest = threads[0];
  if (!newest) return [];
  const record = await deps.threads.getThread(newest.id);
  if (!record) return [];
  return [...record.runs]
    .sort((left, right) => left.startedAt - right.startedAt || (left.id < right.id ? -1 : 1))
    .map((run) => run.prompt.trim())
    .filter(Boolean)
    .slice(-3);
}

export function buildCommitSuggestPrompt(diff: string, prompts: string[]): string {
  const promptBlock =
    prompts.length > 0
      ? `Recent user prompts:\n${prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join('\n')}`
      : 'Recent user prompts: (none)';
  return `${promptBlock}\n\nDiff:\n${diff}`;
}

/** Drop surrounding fences or quotes so the message can be committed as-is. */
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim();
  const fence = /```(?:[\w-]+)?[ \t]*\r?\n?([\s\S]*?)```/.exec(text);
  if (fence?.[1] !== undefined) text = fence[1].trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2) ||
    (text.startsWith('`') && text.endsWith('`') && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}
