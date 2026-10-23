import type { FastifyInstance } from 'fastify';

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI DevTools</title>
</head>
<body>
  <p>AI DevTools gateway — dashboard coming soon</p>
</body>
</html>
`;

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get('/', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(PAGE);
  });
}
