import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { PathEscapeError, confineToRoot, isExecutable, whichCommand } from '@aidev/adapters';
import { HttpError } from '../errors.js';

export class EditorUnavailableError extends Error {
  readonly code = 'editor_unavailable' as const;

  constructor(message = 'No editor is available') {
    super(message);
    this.name = 'EditorUnavailableError';
  }
}

export interface EditorLaunch {
  command: string;
  args: string[];
}

export interface ResolveEditorLaunchOptions {
  editor: string;
  file: string;
  line?: number;
  column?: number;
  which?: (command: string) => Promise<string | null>;
  isExecutable?: (filePath: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
}

export interface OpenEditorOptions {
  root: string;
  file: string;
  line?: number;
  column?: number;
  editor?: string;
  which?: (command: string) => Promise<string | null>;
  isExecutable?: (filePath: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  /** Tests inject a recorder so a real editor is never spawned. */
  launch?: (command: string, args: string[]) => void;
}

const COMMAND_NAME = /^[A-Za-z0-9._+-]+$/;

let testLaunch: OpenEditorOptions['launch'];
let testWhich: OpenEditorOptions['which'];

/** Tests replace spawn/`which` so a real editor is never launched. */
export function setEditorTestHooks(hooks: {
  launch?: OpenEditorOptions['launch'];
  which?: OpenEditorOptions['which'];
} | null): void {
  testLaunch = hooks?.launch;
  testWhich = hooks?.which;
}

/**
 * Confine `file` to `root`, then launch the configured editor detached.
 * Returns the project-relative path that was opened.
 */
export async function openInEditor(options: OpenEditorOptions): Promise<{ file: string }> {
  const absolute = await confineToRoot(options.root, options.file, options.root);
  const relative = toProjectPath(options.root, absolute);
  const launch = await resolveEditorLaunch({
    editor: options.editor?.trim() || 'auto',
    file: absolute,
    ...(options.line !== undefined ? { line: options.line } : {}),
    ...(options.column !== undefined ? { column: options.column } : {}),
    which: options.which ?? testWhich ?? whichCommand,
    ...(options.isExecutable ? { isExecutable: options.isExecutable } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  const run = options.launch ?? testLaunch ?? launchDetached;
  try {
    run(launch.command, launch.args);
  } catch {
    throw new EditorUnavailableError();
  }
  return { file: relative };
}

export async function resolveEditorLaunch(options: ResolveEditorLaunchOptions): Promise<EditorLaunch> {
  const which = options.which ?? whichCommand;
  const executable = options.isExecutable ?? isExecutable;
  const env = options.env ?? process.env;
  const editor = options.editor.trim() || 'auto';
  const goto = gotoArg(options.file, options.line, options.column);

  const ide = async (name: 'cursor' | 'code'): Promise<EditorLaunch | null> => {
    const found = await which(name);
    if (!found) return null;
    return { command: found, args: ['-g', goto] };
  };

  if (editor === 'auto') {
    const cursor = await ide('cursor');
    if (cursor) return cursor;
    const code = await ide('code');
    if (code) return code;
    return envEditor(options.file, env, which, executable);
  }
  if (editor === 'cursor' || editor === 'code') {
    const found = await ide(editor);
    if (!found) throw new EditorUnavailableError(`Editor '${editor}' is not on PATH`);
    return found;
  }
  const command = await resolveCommand(editor, which, executable);
  if (!command) throw new EditorUnavailableError(`Editor '${editor}' is not available`);
  return { command, args: [options.file] };
}

export function editorHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof PathEscapeError) return new HttpError(400, 'path_escape', error.message);
  if (error instanceof EditorUnavailableError) {
    return new HttpError(422, 'editor_unavailable', error.message);
  }
  const message = error instanceof Error ? error.message : 'Failed to open editor';
  if (/escapes the project root|invalid path|path is empty/i.test(message)) {
    return new HttpError(400, 'path_escape', message);
  }
  return new HttpError(422, 'editor_unavailable', message);
}

function gotoArg(file: string, line?: number, column?: number): string {
  if (line === undefined) return file;
  if (column === undefined) return `${file}:${line}`;
  return `${file}:${line}:${column}`;
}

function toProjectPath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return absolute.split(path.sep).join('/');
  return relative.split(path.sep).join('/');
}

async function envEditor(
  file: string,
  env: NodeJS.ProcessEnv,
  which: (command: string) => Promise<string | null>,
  executable: (filePath: string) => Promise<boolean>,
): Promise<EditorLaunch> {
  const name = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (!name) throw new EditorUnavailableError();
  const command = await resolveCommand(name, which, executable);
  if (!command) throw new EditorUnavailableError();
  return { command, args: [file] };
}

async function resolveCommand(
  name: string,
  which: (command: string) => Promise<string | null>,
  executable: (filePath: string) => Promise<boolean>,
): Promise<string | null> {
  if (name.includes('/') || name.includes('\\') || name.includes(' ')) {
    return (await executable(name)) ? name : null;
  }
  if (!COMMAND_NAME.test(name)) return null;
  return which(name);
}

function launchDetached(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
  return child;
}
