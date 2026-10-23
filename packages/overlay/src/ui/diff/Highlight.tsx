import { tokenize } from './tokens.js';

export interface HighlightProps {
  text: string;
  language: string;
}

/** Token spans only. Callers must not pass raw text through `innerHTML`. */
export function Highlight({ text, language }: HighlightProps) {
  if (!text) return null;
  const tokens = tokenize(text, language);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'text' ? (
          token.text
        ) : (
          <span key={index} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}
