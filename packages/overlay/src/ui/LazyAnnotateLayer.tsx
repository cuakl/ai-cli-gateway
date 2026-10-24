import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AnnotateLayerProps } from './AnnotateLayer.js';

type AnnotateComponent = ComponentType<AnnotateLayerProps>;

let loaded: AnnotateComponent | null = null;
let pending: Promise<AnnotateComponent> | null = null;

function loadAnnotate(): Promise<AnnotateComponent> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('./AnnotateLayer.js').then((mod) => {
    loaded = mod.AnnotateLayer;
    return mod.AnnotateLayer;
  });
  return pending;
}

/** Annotation UI, fetched the first time the user starts a screenshot. */
export function LazyAnnotateLayer(props: AnnotateLayerProps) {
  const [Layer, setLayer] = useState<AnnotateComponent | null>(() => loaded);

  useEffect(() => {
    if (Layer) return;
    let cancelled = false;
    void loadAnnotate().then((next) => {
      if (!cancelled) setLayer(() => next);
    });
    return () => {
      cancelled = true;
    };
  }, [Layer]);

  if (!Layer) return null;
  return <Layer {...props} />;
}
