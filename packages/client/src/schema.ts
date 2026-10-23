import { AidevClientError } from './errors.js';

interface ZodLike {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
  _def: unknown;
}

export function isZodSchema(value: unknown): value is ZodLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

export function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isZodSchema(value);
}

/**
 * JSON Schema is sent as-is. A Zod schema is converted with `zod-to-json-schema`
 * when that package is installed; otherwise pass a JSON Schema object.
 */
export async function toJsonSchema(schema: unknown): Promise<Record<string, unknown>> {
  if (isJsonSchema(schema)) return schema;
  if (!isZodSchema(schema)) {
    throw new AidevClientError('schema must be a JSON Schema object or a Zod schema', 'invalid_schema');
  }
  try {
    const mod = (await import('zod-to-json-schema')) as {
      zodToJsonSchema?: (schema: unknown) => unknown;
      default?: { zodToJsonSchema?: (schema: unknown) => unknown } | ((schema: unknown) => unknown);
    };
    const convert =
      mod.zodToJsonSchema ??
      (typeof mod.default === 'function' ? mod.default : mod.default?.zodToJsonSchema);
    if (!convert) throw new Error('zod-to-json-schema export missing');
    const json = convert(schema);
    if (!isJsonSchema(json)) throw new Error('converter did not return an object');
    return json;
  } catch (error) {
    if (error instanceof AidevClientError) throw error;
    throw new AidevClientError(
      'Pass a JSON Schema object, or install zod-to-json-schema to convert a Zod schema',
      'invalid_schema',
      undefined,
      error,
    );
  }
}

export function parseWithSchema<T>(schema: unknown, value: unknown): T {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new AidevClientError('Reply did not match the Zod schema', 'invalid_structured_output', 422, result.error);
    }
    return result.data as T;
  }
  return value as T;
}
