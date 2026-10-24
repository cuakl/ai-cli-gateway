import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { HighlightProps } from './Highlight.js';

type HighlightComponent = ComponentType<HighlightProps>;

let loaded: HighlightComponent | null = null;
let pending: Promise<HighlightComponent> | null = null;

function loadHighlight(): Promise<HighlightComponent> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('./Highlight.js').then((mod) => {
    loaded = mod.Highlight;
    return mod.Highlight;
  });
  return pending;
}

/** Token highlighter, fetched the first time Review paints a diff line. */
export function LazyHighlight({ text, language }: HighlightProps) {
  const [Highlight, setHighlight] = useState<HighlightComponent | null>(() => loaded);

  useEffect(() => {
    if (Highlight) return;
    let cancelled = false;
    void loadHighlight().then((next) => {
      if (!cancelled) setHighlight(() => next);
    });
    return () => {
      cancelled = true;
    };
  }, [Highlight]);

  if (!text) return null;
  if (!Highlight) return <>{text}</>;
  return <Highlight text={text} language={language} />;
}
