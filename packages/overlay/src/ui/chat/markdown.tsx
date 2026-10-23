import type { ComponentChildren, JSX } from 'preact';

export interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps): JSX.Element {
  return <div className="markdown">{renderBlocks(text.replace(/\r\n/g, '\n'))}</div>;
}

function renderBlocks(source: string): ComponentChildren {
  const nodes: ComponentChildren[] = [];
  const lines = source.split('\n');
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const opener = fenceOpen(line);
    if (opener) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (fenceClose(current, opener.marker)) {
          index += 1;
          break;
        }
        codeLines.push(current);
        index += 1;
      }
      nodes.push(renderCode(key++, opener.language, codeLines.join('\n')));
      continue;
    }
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const unordered = unorderedItem(line);
    if (unordered !== null) {
      const items: string[] = [unordered];
      index += 1;
      while (index < lines.length) {
        const item = unorderedItem(lines[index] ?? '');
        if (item === null) break;
        items.push(item);
        index += 1;
      }
      nodes.push(
        <ul key={key++}>
          {items.map((item, itemKey) => (
            <li key={itemKey}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const ordered = orderedItem(line);
    if (ordered) {
      const items: string[] = [ordered.text];
      const start = ordered.start;
      index += 1;
      while (index < lines.length) {
        const item = orderedItem(lines[index] ?? '');
        if (!item) break;
        items.push(item.text);
        index += 1;
      }
      nodes.push(
        <ol key={key++} start={start === 1 ? undefined : start}>
          {items.map((item, itemKey) => (
            <li key={itemKey}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim() === '' ||
        fenceOpen(current) ||
        unorderedItem(current) !== null ||
        orderedItem(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    nodes.push(<p key={key++}>{renderInline(paragraph.join('\n'))}</p>);
  }
  return nodes;
}

function renderCode(key: number, language: string, code: string): JSX.Element {
  return (
    <div key={key} className="md-code" {...(language ? { 'data-language': language } : {})}>
      <button type="button" data-action="copy-code">
        Copy
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInline(text: string): ComponentChildren {
  const nodes: ComponentChildren[] = [];
  let index = 0;
  let key = 0;
  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        nodes.push(<code key={key++}>{text.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      if (end > index + 2) {
        nodes.push(<strong key={key++}>{text.slice(index + 2, end)}</strong>);
        index = end + 2;
        continue;
      }
    }
    if (text[index] === '*') {
      const end = text.indexOf('*', index + 1);
      if (end > index + 1) {
        nodes.push(<em key={key++}>{text.slice(index + 1, end)}</em>);
        index = end + 1;
        continue;
      }
    }
    if (text[index] === '[') {
      const close = text.indexOf('](', index + 1);
      if (close > index + 1) {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd >= close + 2) {
          const label = text.slice(index + 1, close);
          const href = text.slice(close + 2, urlEnd).trim();
          if (isSafeHref(href)) {
            nodes.push(
              <a key={key++} href={href} rel="noreferrer" target="_blank">
                {label}
              </a>,
            );
          } else {
            nodes.push(`[${label}](${href})`);
          }
          index = urlEnd + 1;
          continue;
        }
      }
    }
    const next = nextMarkup(text, index + 1);
    nodes.push(text.slice(index, next));
    index = next;
  }
  return nodes;
}

function nextMarkup(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '`' || char === '*' || char === '[') return index;
  }
  return text.length;
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function fenceOpen(line: string): { marker: string; language: string } | null {
  const match = /^(```+)([^\s`]*)\s*$/.exec(line);
  if (!match) return null;
  return { marker: match[1] ?? '```', language: match[2] ?? '' };
}

function fenceClose(line: string, marker: string): boolean {
  const match = /^(```+)\s*$/.exec(line);
  return Boolean(match && (match[1]?.length ?? 0) >= marker.length);
}

function unorderedItem(line: string): string | null {
  const match = /^[-*] (.+)$/.exec(line);
  return match?.[1] ?? null;
}

function orderedItem(line: string): { start: number; text: string } | null {
  const match = /^(\d+)\. (.+)$/.exec(line);
  if (!match) return null;
  return { start: Number(match[1]), text: match[2] ?? '' };
}
