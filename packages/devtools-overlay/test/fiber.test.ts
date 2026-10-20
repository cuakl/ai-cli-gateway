import { describe, expect, it } from 'vitest';
import { getReactSource } from '../src/inspector/fiber.js';

describe('getReactSource', () => {
  it('walks __reactFiber$ to the fiber with _debugSource', () => {
    const element = document.createElement('button');
    const props: Record<string, unknown> = {
      tone: 'primary',
      onClick: () => undefined,
    };
    props.self = props;
    Object.assign(element, {
      __reactFiber$abc: {
        type: 'button',
        memoizedProps: {},
        return: {
          type: { displayName: 'HeroButton' },
          memoizedProps: props,
          _debugSource: {
            fileName: 'src/components/Hero.tsx',
            lineNumber: 42,
            columnNumber: 5,
          },
          return: null,
        },
      },
    });

    expect(getReactSource(element)).toEqual({
      componentName: 'HeroButton',
      fileName: 'src/components/Hero.tsx',
      lineNumber: 42,
      columnNumber: 5,
      props: {
        tone: 'primary',
        onClick: '[function]',
        self: '[circular]',
      },
    });
  });

  it('reads __reactInternalInstance$ and defaults a missing column to 0', () => {
    const element = document.createElement('div');
    Object.assign(element, {
      __reactInternalInstance$legacy: {
        type: { name: 'Card' },
        memoizedProps: { title: 'Hello' },
        _debugSource: { fileName: 'src/Card.tsx', lineNumber: 8 },
      },
    });

    expect(getReactSource(element)).toMatchObject({
      componentName: 'Card',
      fileName: 'src/Card.tsx',
      lineNumber: 8,
      columnNumber: 0,
      props: { title: 'Hello' },
    });
  });

  it('returns null when the node has no fiber', () => {
    expect(getReactSource(document.createElement('div'))).toBeNull();
  });
});
