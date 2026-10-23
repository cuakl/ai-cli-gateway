import { useEffect, useState } from 'preact/hooks';
import type { ProviderCapabilities } from '@aidev/protocol';
import { ApiError, fetchDoctor, fetchStatus } from '../api.js';
import { yesNo } from '../format.js';

export function ProvidersView({ token }: { token: string }) {
  const [error, setError] = useState('');
  const [version, setVersion] = useState('');
  const [providers, setProviders] = useState<ProviderCapabilities[]>([]);
  const [activeRuns, setActiveRuns] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDoctor(token), fetchStatus(token)])
      .then(([doctor, status]) => {
        if (cancelled) return;
        setVersion(doctor.version || status.version);
        setProviders(doctor.providers.length > 0 ? doctor.providers : status.providers);
        setActiveRuns(status.activeRuns);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load providers');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section>
      <p className="kicker">Gateway</p>
      <h1 className="page-title">Providers</h1>
      {error ? <p className="banner">{error}</p> : null}
      <p className="muted">
        v{version || '…'} · {activeRuns} active run{activeRuns === 1 ? '' : 's'}
      </p>
      <div className="table-wrap" style={{ marginTop: 'var(--aid-space-4)' }}>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Available</th>
              <th>Version</th>
              <th>Verified</th>
              <th>Modes</th>
              <th>Models</th>
              <th>Resume</th>
              <th>Images</th>
              <th>JSON schema</th>
              <th>System</th>
              <th>Binary</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 ? (
              <tr>
                <td colSpan={11} className="muted">
                  Loading capability matrix…
                </td>
              </tr>
            ) : (
              providers.map((item) => (
                <tr key={item.provider}>
                  <td>
                    <strong>{item.provider}</strong>
                    {item.setup && item.setup.length > 0 ? (
                      <ol className="setup">
                        {item.setup.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                  </td>
                  <td>
                    <span className={`pill ${item.available ? 'ok' : 'no'}`}>{yesNo(item.available)}</span>
                  </td>
                  <td>{item.version ?? '—'}</td>
                  <td>
                    <span className={`pill ${item.verified ? 'ok' : 'warn'}`}>{yesNo(item.verified)}</span>
                  </td>
                  <td>{item.modes.join(', ') || '—'}</td>
                  <td title={item.models.map((model) => model.label).join(', ') || undefined}>
                    {item.models.length === 0
                      ? '—'
                      : `${item.models.length} model${item.models.length === 1 ? '' : 's'}`}
                  </td>
                  <td>{yesNo(item.supportsResume)}</td>
                  <td>{yesNo(item.supportsImages)}</td>
                  <td>{yesNo(item.supportsJsonSchema)}</td>
                  <td>{yesNo(item.supportsSystemPrompt)}</td>
                  <td className="path">{item.binaryPath ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
