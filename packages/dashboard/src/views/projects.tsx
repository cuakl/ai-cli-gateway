import { useEffect, useState } from 'preact/hooks';
import { ApiError, fetchProjects, type ProjectRecord } from '../api.js';
import { formatTime } from '../format.js';

export function ProjectsView({ token }: { token: string }) {
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects(token)
      .then((body) => {
        if (!cancelled) setProjects(body.projects);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load projects');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section>
      <p className="kicker">Workspace</p>
      <h1 className="page-title">Projects</h1>
      {error ? <p className="banner">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Root</th>
              <th>Origins</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {projects === null ? (
              <tr>
                <td colSpan={4} className="muted">
                  Loading projects…
                </td>
              </tr>
            ) : projects.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No registered projects. Run <code>aidev projects add</code> or start a Vite app with the plugin.
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.name}</strong>
                  </td>
                  <td className="path">{project.root}</td>
                  <td>{project.origins.join(', ') || '—'}</td>
                  <td>{formatTime(project.lastSeenAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
