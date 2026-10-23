import type { InferMessage } from '@aidev/protocol';
import { HttpError } from '../errors.js';

export interface RenderedInferPrompt {
  prompt: string;
  instruction: string;
  systemPrompt?: string;
}

const SCHEMA_PREFIX = 'Reply with only a JSON value matching this JSON Schema: ';

export function schemaSystemInstruction(schema: Record<string, unknown>): string {
  return `${SCHEMA_PREFIX}${JSON.stringify(schema)}`;
}

/**
 * System-role messages and `system` become `systemPrompt`. Prior turns are a
 * `<conversation>` block. The last user message is the instruction.
 */
export function renderInferPrompt(
  messages: InferMessage[],
  system?: string,
  schemaInstruction?: string,
): RenderedInferPrompt {
  const systemParts: string[] = [];
  if (system?.trim()) systemParts.push(system.trim());
  for (const message of messages) {
    if (message.role === 'system' && message.content.trim()) {
      systemParts.push(message.content.trim());
    }
  }
  if (schemaInstruction?.trim()) systemParts.push(schemaInstruction.trim());

  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }
  if (lastUser === -1) {
    throw new HttpError(400, 'validation_error', 'messages: at least one user message is required');
  }
  const instruction = messages[lastUser]?.content ?? '';
  if (!instruction.trim()) {
    throw new HttpError(400, 'validation_error', 'messages: the last user message must not be empty');
  }

  const prior = messages
    .slice(0, lastUser)
    .filter((message) => message.role === 'user' || message.role === 'assistant');
  const prompt =
    prior.length === 0 ? instruction : `${formatTranscript(prior)}\n\n${instruction}`;

  return {
    prompt,
    instruction,
    ...(systemParts.length > 0 ? { systemPrompt: systemParts.join('\n\n') } : {}),
  };
}

export function retryPrompt(original: string, issues: unknown, schema: Record<string, unknown>): string {
  return `${original}\n\nThe previous reply was not valid JSON for the schema.\nIssues:\n${formatIssues(issues)}\n${schemaSystemInstruction(schema)}`;
}

function formatTranscript(messages: InferMessage[]): string {
  const lines = messages.map((message) => {
    const speaker = message.role === 'user' ? 'User' : 'Assistant';
    return `${speaker}: ${message.content}`;
  });
  return `<conversation>\n${lines.join('\n')}\n</conversation>`;
}

export function formatIssues(issues: unknown): string {
  if (typeof issues === 'string') return issues;
  if (!Array.isArray(issues) || issues.length === 0) return JSON.stringify(issues);
  return issues
    .map((issue) => {
      if (typeof issue === 'string') return `- ${issue}`;
      if (isRecord(issue)) {
        const path = Array.isArray(issue.instancePath)
          ? issue.instancePath.join('.')
          : typeof issue.instancePath === 'string'
            ? issue.instancePath
            : '';
        const message = typeof issue.message === 'string' ? issue.message : JSON.stringify(issue);
        return path ? `- ${path}: ${message}` : `- ${message}`;
      }
      return `- ${JSON.stringify(issue)}`;
    })
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
