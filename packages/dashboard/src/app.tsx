import { useEffect, useState } from 'preact/hooks';
import { captureTokenFromHash } from './auth.js';
import { hrefFor, parseRoute, type Route } from './routes.js';
import { PlaygroundView } from './views/playground.js';
import { ProjectsView } from './views/projects.js';
import { ProvidersView } from './views/providers.js';
import { ThreadDetailView, ThreadsView } from './views/threads.js';

const NAV: Array<{ route: Route; label: string }> = [
  { route: { name: 'providers' }, label: 'Providers' },
  { route: { name: 'projects' }, label: 'Projects' },
  { route: { name: 'threads' }, label: 'Threads' },
  { route: { name: 'playground' }, label: 'Playground' },
];

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    setToken(captureTokenFromHash(window.location, window.history, window.sessionStorage));
  }, []);

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (!token) {
    return (
      <main className="locked card">
        <p className="kicker">AI DevTools</p>
        <h1 className="page-title">Dashboard</h1>
        <p>
          Open this page with <code>aidev open</code>. That command puts the machine token in the URL hash once, then
          this app stores it in sessionStorage and removes it from the address bar.
        </p>
      </main>
    );
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="Dashboard">
        <p className="brand">AI DevTools</p>
        {NAV.map((item) => {
          const current =
            item.route.name === 'threads'
              ? route.name === 'threads' || route.name === 'thread'
              : route.name === item.route.name;
          return (
            <a
              key={item.label}
              href={hrefFor(item.route)}
              aria-current={current ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (hrefFor(item.route) === window.location.pathname) {
                  setRoute(item.route);
                  return;
                }
                window.history.pushState(null, '', hrefFor(item.route));
                setRoute(item.route);
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <main className="main">{renderRoute(token, route)}</main>
    </div>
  );
}

function renderRoute(token: string, route: Route) {
  if (route.name === 'projects') return <ProjectsView token={token} />;
  if (route.name === 'threads') return <ThreadsView token={token} />;
  if (route.name === 'thread') return <ThreadDetailView token={token} id={route.id} />;
  if (route.name === 'playground') return <PlaygroundView token={token} />;
  return <ProvidersView token={token} />;
}
