export type Route =
  | { name: 'providers' }
  | { name: 'projects' }
  | { name: 'threads' }
  | { name: 'thread'; id: string }
  | { name: 'playground' };

const BASE = '/dashboard';

export function parseRoute(pathname: string): Route {
  const rest = pathname.replace(/^\/dashboard\/?/, '').replace(/\/+$/, '');
  if (rest === '' || rest === 'providers') return { name: 'providers' };
  if (rest === 'projects') return { name: 'projects' };
  if (rest === 'threads') return { name: 'threads' };
  if (rest === 'playground') return { name: 'playground' };
  const thread = /^threads\/([^/]+)$/.exec(rest);
  if (thread?.[1]) return { name: 'thread', id: decodeURIComponent(thread[1]) };
  return { name: 'providers' };
}

export function hrefFor(route: Route): string {
  if (route.name === 'providers') return `${BASE}/`;
  if (route.name === 'projects') return `${BASE}/projects`;
  if (route.name === 'threads') return `${BASE}/threads`;
  if (route.name === 'playground') return `${BASE}/playground`;
  return `${BASE}/threads/${encodeURIComponent(route.id)}`;
}

export function navigate(route: Route): void {
  const url = hrefFor(route);
  if (`${window.location.pathname}${window.location.search}` === url) return;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
