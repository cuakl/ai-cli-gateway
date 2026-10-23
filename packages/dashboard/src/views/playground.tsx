import { useEffect, useState } from 'preact/hooks';
import type { ProviderCapabilities } from '@aidev/protocol';
import { ApiError, fetchDoctor, streamInfer } from '../api.js';
import { inferCurl } from '../curl.js';

export function PlaygroundView({ token }: { token: string }) {
  const [providers, setProviders] = useState<ProviderCapabilities[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Reply with exactly: pong');
  const [schemaText, setSchemaText] = useState('');
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDoctor(token)
      .then((body) => {
        if (cancelled) return;
        setProviders(body.providers);
        const first = body.providers.find((item) => item.available) ?? body.providers[0];
        if (first) {
          setProvider(first.provider);
          setModel(first.models[0]?.id ?? '');
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load providers');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selected = providers.find((item) => item.provider === provider);
  const jsonSchema = parseSchema(schemaText);
  const curl = inferCurl({
    origin: window.location.origin,
    prompt,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(jsonSchema.ok && jsonSchema.value !== undefined ? { jsonSchema: jsonSchema.value } : {}),
    stream: true,
  });

  async function onRun(): Promise<void> {
    setError('');
    setResult('');
    setStreamText('');
    if (!jsonSchema.ok) {
      setError(jsonSchema.error);
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      };
      if (provider) body.provider = provider;
      if (model) body.model = model;
      if (jsonSchema.value !== undefined) body.jsonSchema = jsonSchema.value;
      const done = await streamInfer(token, body, (text) => {
        setStreamText((current) => current + text);
      });
      setResult(done.object !== undefined ? JSON.stringify(done.object, null, 2) : done.text);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Infer failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCopyCurl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to the clipboard');
    }
  }

  return (
    <section className="stack">
      <div>
        <p className="kicker">Inference</p>
        <h1 className="page-title">Playground</h1>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="toolbar">
        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setProvider(next);
              const match = providers.find((item) => item.provider === next);
              setModel(match?.models[0]?.id ?? '');
            }}
          >
            {providers.map((item) => (
              <option key={item.provider} value={item.provider}>
                {item.provider}
                {item.available ? '' : ' (missing)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(event) => setModel(event.currentTarget.value)}>
            <option value="">Default</option>
            {(selected?.models ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Prompt</span>
        <textarea className="prompt" value={prompt} onInput={(event) => setPrompt(event.currentTarget.value)} />
      </label>
      <label className="field">
        <span>JSON schema (optional)</span>
        <textarea
          value={schemaText}
          placeholder='{ "type": "object", "properties": { "ok": { "type": "boolean" } } }'
          onInput={(event) => setSchemaText(event.currentTarget.value)}
        />
      </label>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !prompt.trim()} onClick={() => void onRun()}>
          {busy ? 'Running…' : 'Run'}
        </button>
        <button type="button" className="ghost" onClick={() => void onCopyCurl()}>
          {copied ? 'Copied' : 'Copy curl'}
        </button>
      </div>
      <div>
        <p className="kicker">Stream</p>
        <pre className="stream">{streamText || (busy ? 'Waiting for deltas…' : '')}</pre>
      </div>
      <div>
        <p className="kicker">Result</p>
        <pre className="stream">{result}</pre>
      </div>
      <div>
        <p className="kicker">curl</p>
        <pre className="curl">{curl}</pre>
      </div>
    </section>
  );
}

function parseSchema(text: string): { ok: true; value?: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: 'JSON schema is not valid JSON' };
  }
}
