/**
 * Splits a byte stream into lines without dropping a trailing partial line.
 * CLI NDJSON often arrives in chunks that do not align with newlines.
 */
export class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    if (chunk.length === 0) return [];
    this.pending += chunk;
    const parts = this.pending.split(/\r?\n/);
    this.pending = parts.pop() ?? '';
    return parts.filter((line) => line.length > 0);
  }

  flush(): string[] {
    if (this.pending.length === 0) return [];
    const line = this.pending;
    this.pending = '';
    return [line];
  }
}
