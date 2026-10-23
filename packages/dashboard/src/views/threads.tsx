import { useEffect, useState } from 'preact/hooks';
import type { ThreadSource } from '@aidev/protocol';
import {
  ApiError,
  deleteThread,
  fetchProjects,
  fetchThread,
  fetchThreads,
  keepThread,
  type ProjectRecord,
  type ThreadDetail,
  type ThreadListItem,
} from '../api.js';
import { formatTime, yesNo } from '../format.js';
import { hrefFor, navigate } from '../routes.js';
import { ThreadTranscript } from '../thread-transcript.js';

const SOURCES: Array<ThreadSource | ''> = ['', 'overlay', 'api', 'openai', 'dashboard'];

export function ThreadsView({ token }: { token: string }) {
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState('');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [threads, setThreads] = useState<ThreadListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects(token)
      .then((body) => {
        if (!cancelled) setProjects(body.projects);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setThreads(null);
    fetchThreads(token, {
      ...(projectId ? { projectId } : {}),
      ...(source ? { source } : {}),
    })
      .then((body) => {
        if (!cancelled) setThreads(body.threads);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load threads');
      });
    return () => {
      cancelled = true;
    };
  }, [token, projectId, source]);

  const names = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <section>
      <p className="kicker">History</p>
      <h1 className="page-title">Threads</h1>
      {error ? <p className="banner">{error}</p> : null}
      <div className="toolbar">
        <label className="field">
          <span>Project</span>
          <select value={projectId} onChange={(event) => setProjectId(event.currentTarget.value)}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Source</span>
          <select value={source} onChange={(event) => setSource(event.currentTarget.value)}>
            {SOURCES.map((item) => (
              <option key={item || 'all'} value={item}>
                {item || 'All sources'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Project</th>
              <th>Provider</th>
              <th>Time</th>
              <th>Runs</th>
              <th>Kept</th>
            </tr>
          </thead>
          <tbody>
            {threads === null ? (
              <tr>
                <td colSpan={7} className="muted">
                  Loading threads…
                </td>
              </tr>
            ) : threads.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No threads match these filters.
                </td>
              </tr>
            ) : (
              threads.map((thread) => (
                <tr
                  key={thread.id}
                  className="clickable"
                  onClick={() => navigate({ name: 'thread', id: thread.id })}
                >
                  <td>
                    <a href={hrefFor({ name: 'thread', id: thread.id })} onClick={(event) => event.preventDefault()}>
                      {thread.title || thread.id}
                    </a>
                  </td>
                  <td>
                    <span className="pill">{thread.source}</span>
                  </td>
                  <td>{thread.projectId ? (names.get(thread.projectId) ?? thread.projectId.slice(0, 12)) : '—'}</td>
                  <td>{thread.provider}</td>
                  <td>{formatTime(thread.updatedAt)}</td>
                  <td>{thread.runCount}</td>
                  <td>
                    <span className={`pill ${thread.keep ? 'ok' : 'no'}`}>{yesNo(thread.keep)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ThreadDetailView({ token, id }: { token: string; id: string }) {
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchThread(token, id)
      .then((body) => {
        if (!cancelled) setDetail(body);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load thread');
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  async function onKeep(): Promise<void> {
    setBusy(true);
    try {
      const body = await keepThread(token, id, true);
      setDetail((current) => (current ? { ...current, thread: body.thread } : current));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Keep failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!window.confirm('Delete this thread and its event log?')) return;
    setBusy(true);
    try {
      await deleteThread(token, id);
      navigate({ name: 'threads' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Delete failed');
      setBusy(false);
    }
  }

  const thread = detail?.thread;
  return (
    <section>
      <p className="kicker">
        <a
          href={hrefFor({ name: 'threads' })}
          onClick={(event) => {
            event.preventDefault();
            navigate({ name: 'threads' });
          }}
        >
          Threads
        </a>
      </p>
      <div className="detail-head">
        <h1 className="page-title">{thread?.title ?? 'Thread'}</h1>
        <div className="actions">
          <button type="button" className="ghost" disabled={busy || thread?.keep === true} onClick={() => void onKeep()}>
            Keep
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => void onDelete()}>
            Delete
          </button>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {detail ? (
        <p className="muted">
          {detail.thread.source} · {detail.thread.provider}
          {detail.thread.model ? `/${detail.thread.model}` : ''} · {formatTime(detail.thread.updatedAt)} · kept{' '}
          {yesNo(detail.thread.keep)} · {detail.runs.length} run{detail.runs.length === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="muted">Loading transcript…</p>
      )}
      {detail ? (
        <div className="transcript-host" style={{ marginTop: 'var(--aid-space-4)' }}>
          <ThreadTranscript runs={detail.runs} events={detail.events} />
        </div>
      ) : null}
    </section>
  );
}
