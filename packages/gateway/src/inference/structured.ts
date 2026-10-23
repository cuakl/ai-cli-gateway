import { Ajv, type ErrorObject } from 'ajv';
import { HttpError } from '../errors.js';

export type StructuredCheck =
  | { ok: true; value: unknown }
  | { ok: false; issues: unknown };

/**
 * First JSON object or array in `text`. Fenced ` ```json ` blocks are preferred.
 */
export function extractJsonValue(text: string): unknown | undefined {
  const fenced = fenceBody(text);
  if (fenced !== undefined) {
    const fromFence = parseFirstJson(fenced);
    if (fromFence !== undefined) return fromFence;
  }
  return parseFirstJson(text);
}

export function checkStructuredOutput(
  schema: Record<string, unknown>,
  text: string,
): StructuredCheck {
  const value = extractJsonValue(text);
  if (value === undefined || (typeof value !== 'object' && !Array.isArray(value)) || value === null) {
    return { ok: false, issues: [{ message: 'Reply did not contain a JSON object or array' }] };
  }
  return validateAgainstSchema(schema, value);
}

export function validateAgainstSchema(schema: Record<string, unknown>, value: unknown): StructuredCheck {
  const ajv = new Ajv({ allErrors: true, strict: false });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'jsonSchema is not a valid JSON Schema';
    throw new HttpError(400, 'validation_error', message);
  }
  if (validate(value)) return { ok: true, value };
  const issues: ErrorObject[] = validate.errors ?? [];
  return { ok: false, issues: issues.length > 0 ? issues : [{ message: 'JSON did not match the schema' }] };
}

function fenceBody(text: string): string | undefined {
  const match = /```(?:json)?\s*\r?\n?([\s\S]*?)```/i.exec(text);
  const body = match?.[1];
  return body !== undefined ? body.trim() : undefined;
}

function parseFirstJson(text: string): unknown | undefined {
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch !== '{' && ch !== '[') continue;
    const sliced = sliceJson(text, index);
    if (sliced === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(sliced);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

function sliceJson(text: string, start: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === undefined) break;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack.at(-1) !== ch) return undefined;
      stack.pop();
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
