import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { injectDataLoc } from '../src/jsx-transform.js';

const root = path.resolve('/proj');

function sourceId(file: string): string {
  return path.join(root, file);
}

const view = [
  'export function View() {',
  '  return (',
  '    <div>',
  '      <button>Go</button>',
  '      <HeroButton />',
  '      <Card title="x" />',
  '    </div>',
  '  );',
  '}',
].join('\n');

describe('injectDataLoc', () => {
  it('stamps host and component tags with filepath, line, and column', () => {
    const result = injectDataLoc(view, sourceId('src/App.tsx'), root);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('data-loc="src/App.tsx:3:4"');
    expect(result?.code).toContain('<button data-loc="src/App.tsx:4:6">');
    expect(result?.code).toContain('<HeroButton data-loc="src/App.tsx:5:6" />');
    expect(result?.code).toContain('<Card data-loc="src/App.tsx:6:6" title="x" />');
    expect(result?.map?.mappings).toBeTruthy();
  });

  it('keeps an explicit data-loc and still stamps siblings', () => {
    const code = [
      'export function View() {',
      '  return (',
      '    <div>',
      '      <button data-loc="src/Keep.tsx:9:1">Ok</button>',
      '      <i />',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const result = injectDataLoc(code, sourceId('src/App.tsx'), root);
    expect(result?.code).toContain('data-loc="src/Keep.tsx:9:1"');
    expect(result?.code).toContain('<div data-loc="src/App.tsx:3:4">');
    expect(result?.code.match(/data-loc="/g)).toHaveLength(3);
    expect(result?.code).toContain('<i data-loc="src/App.tsx:5:6" />');
  });

  it('does not overwrite a data-loc expression', () => {
    const code = 'export const node = <button data-loc={"src/Keep.tsx:2:2"}>Ok</button>;\n';
    expect(injectDataLoc(code, sourceId('src/App.tsx'), root)).toBeNull();
  });

  it('places the attribute after a generic type argument', () => {
    const code = 'export const node = <Select<string> value="a" />;\n';
    const result = injectDataLoc(code, sourceId('src/Field.tsx'), root);
    expect(result?.code).toContain('<Select<string> data-loc="src/Field.tsx:1:20"');
  });

  it('stamps member expressions and skips fragments', () => {
    const code = [
      'export function View() {',
      '  return (',
      '    <>',
      '      <Menu.Item />',
      '      <React.Fragment><span>Hi</span></React.Fragment>',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    const result = injectDataLoc(code, sourceId('src/App.tsx'), root);
    expect(result?.code).toContain('<>');
    expect(result?.code).not.toContain('Fragment data-loc');
    expect(result?.code).toContain('<Menu.Item data-loc="src/App.tsx:4:6" />');
    expect(result?.code).toContain('<span data-loc="src/App.tsx:5:22">');
    expect(result?.code.match(/data-loc="/g)).toHaveLength(2);
  });

  it('ignores query strings when building the relative path', () => {
    const result = injectDataLoc('<div />\n', `${sourceId('src/App.tsx')}?t=1`, root);
    expect(result?.code).toContain('data-loc="src/App.tsx:1:0"');
  });

  it('leaves non-JSX modules untouched', () => {
    expect(injectDataLoc('export const n = 1;\n', sourceId('src/util.ts'), root)).toBeNull();
    expect(injectDataLoc('export const n = 1;\n', sourceId('src/util.js'), root)).toBeNull();
    expect(injectDataLoc('.a { color: red; }\n', sourceId('src/app.css'), root)).toBeNull();
  });

  it('skips node_modules and Vite virtual modules', () => {
    const jsx = 'export const node = <div />;\n';
    expect(injectDataLoc(jsx, sourceId('node_modules/pkg/Button.tsx'), root)).toBeNull();
    expect(injectDataLoc(jsx, '\0virtual:button.tsx', root)).toBeNull();
    expect(injectDataLoc(jsx, 'virtual:button.tsx', root)).toBeNull();
  });

  it('returns null for a TSX module with no JSX', () => {
    expect(injectDataLoc('export const label = "hi";\n', sourceId('src/labels.tsx'), root)).toBeNull();
  });
});
