declare module 'zod-to-json-schema' {
  export function zodToJsonSchema(schema: unknown): Record<string, unknown>;
  const value: { zodToJsonSchema: typeof zodToJsonSchema };
  export default value;
}
