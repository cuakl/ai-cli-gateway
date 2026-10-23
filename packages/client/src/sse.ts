export interface SseFrame {
  event: string;
  data: unknown;
}

/** Parse `text/event-stream` from `/api/v1/infer` (`event: delta` / `event: done`). */
export async function* readNamedSse(response: Response): AsyncGenerator<SseFrame> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const frame = parseBlock(block);
        if (frame) yield frame;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const frame = parseBlock(buffer);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseFrame | undefined {
  if (!block.trim()) return undefined;
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return undefined;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) as unknown };
  } catch {
    return { event, data: raw };
  }
}
