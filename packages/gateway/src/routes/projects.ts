import { OpenEditorRequestSchema, ProjectRegisterRequestSchema } from '@aidev/protocol';
import type { FastifyInstance } from 'fastify';
import { requirePrincipal, sendForbidden } from '../auth/principal.js';
import { HttpError, sendHttpError } from '../errors.js';
import type { ServerDeps } from '../types.js';
import { editorHttpError, openInEditor } from '../workspace/editor.js';

export function registerProjectRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/v1/projects/register', async (request, reply) => {
    if (requirePrincipal(request).kind !== 'machine') return sendForbidden(reply);
    const parsed = ProjectRegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid register request';
      return sendHttpError(reply, new HttpError(400, 'validation_error', message, parsed.error.issues));
    }
    try {
      const { project, browserToken } = await deps.projects.register({
        root: parsed.data.root,
        origin: parsed.data.origin,
        ...(parsed.data.allowRemoteShell !== undefined
          ? { allowRemoteShell: parsed.data.allowRemoteShell }
          : {}),
      });
      return { projectId: project.id, browserToken };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return sendHttpError(reply, new HttpError(400, 'invalid_root', 'Project root does not exist'));
      }
      throw error;
    }
  });

  app.get('/api/v1/projects', async (request, reply) => {
    if (requirePrincipal(request).kind !== 'machine') return sendForbidden(reply);
    return { projects: deps.projects.list() };
  });

  app.post('/api/v1/projects/:projectId/open', async (request, reply) => {
    const principal = requirePrincipal(request);
    const projectId = String((request.params as { projectId?: string }).projectId ?? '');
    const project = deps.projects.get(projectId);
    if (!project) {
      return sendHttpError(reply, new HttpError(404, 'not_found', `Project ${projectId} was not found`));
    }
    if (principal.kind === 'browser' && principal.projectId !== projectId) return sendForbidden(reply);
    const parsed = OpenEditorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid open request';
      return sendHttpError(reply, new HttpError(400, 'validation_error', message, parsed.error.issues));
    }
    try {
      return await openInEditor({
        root: project.root,
        file: parsed.data.file,
        editor: deps.config.editor ?? 'auto',
        ...(parsed.data.line !== undefined ? { line: parsed.data.line } : {}),
        ...(parsed.data.column !== undefined ? { column: parsed.data.column } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, editorHttpError(error));
    }
  });
}
