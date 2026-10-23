# Manual

This is the operator's guide for the gateway and the in-browser overlay: how to run the Lumen demo, how to drop the toolbar into another Vite app, and how to call the HTTP API yourself.

## The loop

The overlay collects context in the page and sends each chat prompt straight to the gateway. Git diffs, the terminal, and tests go over the Vite dev socket. The gateway runs one already-authenticated CLI in the project directory and normalizes its output into a single event stream. The CLI writes files on disk. Vite hot-reloads them. You commit from the drawer.

```
browser overlay  →  gateway :4100  →  agent | agy | claude | codex
        │                 ↑
        │                 └── chat stream events
        └─ Vite dev socket: git, terminal, tests
```

Toolbar chat does not use the Vite socket. The plugin still listens for `ai-devtools:prompt`. On that path only, it can run the adapter in-process when the gateway is down, warn about a dirty git tree, and hold full page reloads. The overlay never sends prompts there, so none of those three apply to a chat from the toolbar.

## Run the Lumen demo

From the repository root, in two terminals:

```bash
pnpm install
pnpm build
pnpm --filter @aidev/gateway dev
```

```bash
pnpm demo
```

Open http://127.0.0.1:5173. The toolbar is injected in development only.

![The Lumen storefront and the AI DevTools toolbar](images/lumen-storefront.png)

Lumen is a small storefront: a header, a hero, a quantity counter, product cards, a note form with validation, and a diagnostics panel that can log a warning, log an error, or throw. Those pieces give the inspector something real to select.

Confirm the gateway is up, then ask it which CLIs it can see. `/health` is open and only reports status and version. Provider details require the machine token from `~/.aidev/token`:

```bash
curl -s http://127.0.0.1:4100/health
```

```json
{ "status": "ok", "version": "0.0.1" }
```

```bash
curl -s http://127.0.0.1:4100/api/v1/status \
  -H "authorization: Bearer $(cat ~/.aidev/token)"
```

The status body includes `activeRuns`, `projects`, and `providers`. `GET /api/v1/providers` returns the same provider list under `providers`. Choose a provider whose `available` is `true`. `/health` also includes `availableProviders` when the same bearer token is sent, which is what the overlay polls.

## Use the overlay

The toolbar is a custom element, `<ai-devtools>`, rendered in an open shadow root so the page's CSS does not restyle it. The dot next to the name is green when `GET /health` succeeds.

### Inspect and chat

Click **Inspect**, then click an element. The click is captured before the page's own handlers, so selecting the hero button does not add the lamp to the cart. Press Escape to leave inspect mode without selecting.

The chip names the React component and the source location. React Fiber `_debugSource` is preferred. Anything else uses the `data-loc="file:line:col"` attribute the Vite plugin stamps onto JSX.

![Chat open on the hero button, with a source chip and a prompt](images/lumen-inspect-chat.png)

The prompt sent to the CLI includes:

- the selected element: tag, id, class, a slice of outer HTML, and a few computed styles
- the source location and React props when Fiber exposes them
- the last console errors, warnings, and unhandled exceptions
- recent failed network requests
- a screenshot of the element, when the browser allows it

Suggestions ("Fix layout", "Make responsive", "Add hover state") only fill the box. Send with the button or with Cmd/Ctrl+Enter. **Stop** cancels the running session. Send stays disabled, with a tooltip, when the selected provider is known to be missing. Those options are disabled in the provider menu.

A dirty or conflicted git tree is not announced in the chat. After the agent edits files, a notice offers **Review diffs**.

### Diffs

**Diffs** lists staged, unstaged, and untracked files inside the Vite project. Each file shows additions and deletions. The hunk view is the unified diff.

![The diff viewer on a one-line hero button edit](images/lumen-diffs.png)

Type a commit message and click **Commit Changes**. "Push to origin" pushes the current branch after the commit succeeds. **Discard** asks for confirmation, then restores tracked files and removes untracked files that the summary listed. Paths that leave the project directory are rejected.

The badge on the toolbar is the number of files in the summary.

### Terminal

**Terminal** starts `$SHELL` (or `bash`) in the Vite project directory and connects it to an xterm.js pane. `node-pty` is used when its native binding loads. If it does not, the plugin falls back to a piped interactive shell.

![A shell session in the demo directory](images/lumen-terminal.png)

Switching to Chat, Diffs, or Tests leaves the shell running. The close button on the terminal panel disposes that session. The shell is the same user as the Vite process, so it can run git, pnpm, and the project scripts.

### Tests

**Tests** runs the project's `test` script. It walks up from the Vite root and prefers pnpm (`pnpm-lock.yaml` or `pnpm-workspace.yaml`), then npm, then yarn. With no script, a project that depends on Vitest runs `npx vitest run`. Output streams into the panel. The badge reads Passed or Failed from the exit code. **Stop** aborts the run in progress. The kicker above the title is the `name` from the Vite project's `package.json`, or **Tests** when that name is missing.

![The test runner after the Lumen suite passed](images/lumen-tests.png)

Starting another run aborts the one in progress.

## Add the overlay to a Vite app

Install the workspace package, or depend on `@aidev/vite` from this repo, and register it:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiDevtools } from '@aidev/vite';

export default defineConfig({
  plugins: [react(), aiDevtools()],
});
```

During `serve` the plugin does four things:

1. Injects a config script and `<script type="module" src="/@ai-devtools/overlay.js">` into `<head>`. The config is `globalThis.__AI_DEVTOOLS__`: the Vite WebSocket token, the gateway URL, the project root used as `cwd`, and the `name` from `package.json` when it has one.
2. Serves the overlay bundle from `@aidev/overlay`.
3. Writes `data-loc` onto JSX elements that do not already have one. The column is Babel's 0-based column.
4. Handles git diff, commit, revert, PTY, and test messages on Vite's HMR socket. Chat prompts are not in that list. The overlay calls the gateway itself. The socket still accepts `ai-devtools:prompt`, but the toolbar does not send it.

`aiDevtools()` accepts:

| Option | Default | Effect |
| --- | --- | --- |
| `gatewayUrl` | `GATEWAY_URL` or `http://127.0.0.1:4100` | Gateway origin injected into the page. Toolbar chat calls it directly. |
| `enabled` | `true` while serving, `false` for builds | Turns injection and the socket bridge off. |
| `injectDataLoc` | `true` | Turns the JSX source stamp off. |

The file watcher waits briefly for a write to finish. The plugin can also hold Vite `full-reload` messages, but only while a prompt is running on the socket. Toolbar chat does not start that hold, so a chat run does not delay a full reload. Module hot updates still apply as files change.

Start the gateway with `aidev start` (or `pnpm --filter @aidev/gateway dev`). The first start creates `~/.aidev` (`AIDEV_HOME` overrides that directory), a mode `0600` machine token, and `config.json`. Register a repo with `aidev projects add <path>`, or set `GATEWAY_ROOT` to auto-register one root at startup. The Vite plugin registers the project it is serving and injects a project-scoped browser token. A prompt `cwd` must resolve inside a registered project. A symlink whose target leaves that project is rejected.

## Call the gateway directly

The server listens on `127.0.0.1:4100` unless `HOST` and `PORT` say otherwise.

### One-shot prompt

`POST /api/v1/prompt` runs the CLI and returns when it exits.

```bash
curl -s http://127.0.0.1:4100/api/v1/prompt \
  -H "authorization: Bearer $(cat ~/.aidev/token)" \
  -H 'content-type: application/json' \
  -d '{
    "provider": "claude",
    "cwd": "'"$PWD"'",
    "prompt": "Add a hover transition to the hero button"
  }'
```

A successful body is `{ exitCode, summary, events }`. `events` is the unified stream: `init`, `chunk`, `tool_call`, `tool_result`, `file_edit`, `error`, and `done`.

### Session and Server-Sent Events

Use a session when you want tokens as they arrive. This is what `examples/gateway-client/test-prompt.ts` does.

```bash
curl -s http://127.0.0.1:4100/api/v1/sessions \
  -H "authorization: Bearer $(cat ~/.aidev/token)" \
  -H 'content-type: application/json' \
  -d '{
    "provider": "cursor",
    "cwd": "'"$PWD"'",
    "prompt": "Say hello in one short sentence.",
    "ephemeral": true
  }'
```

```json
{
  "sessionId": "sess_01H...",
  "status": "running",
  "streamUrl": "/api/v1/sessions/sess_01H.../stream"
}
```

```bash
curl -N http://127.0.0.1:4100/api/v1/sessions/sess_01H.../stream \
  -H "authorization: Bearer $(cat ~/.aidev/token)"
```

Each frame is one unified event:

```
event: chunk
data: {"id":"...","sessionId":"sess_01H...","type":"chunk","timestamp":1760990000000,"payload":{"text":"Hello"}}

event: done
data: {"id":"...","sessionId":"sess_01H...","type":"done","timestamp":1760990001000,"payload":{"durationMs":812}}
```

`GET /api/v1/sessions/:id` returns the session record: `id`, `provider`, `cwd`, `status`, `createdAt`, `updatedAt`, and `exitCode` once the run has finished. It does not include events. Events are the SSE stream at `GET /api/v1/sessions/:id/stream`. `DELETE /api/v1/sessions/:id` aborts a running session.

`ephemeral: true` asks the Cursor adapter to delete `.cursor/worktrees/<sessionId>` and `.cursor/sessions/<sessionId>` after the process exits. Other providers ignore it.

### WebSocket

Connect to `ws://127.0.0.1:4100/ws?token=<token>`. Browsers may send `Authorization: Bearer <token>` instead of the query string. The token is the machine token or a browser token from project registration.

```json
{ "type": "prompt", "provider": "antigravity", "cwd": "/path/to/app", "prompt": "Tighten the hero spacing", "yolo": true }
```

The server replies with `{ "type": "ready", "sessionId": "..." }`, then `{ "type": "event", "event": { ... } }` for each stream event. Cancel with `{ "type": "cancel", "sessionId": "..." }`.

### Prompt fields

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | `cursor`, `antigravity`, `claude`, or `codex`. |
| `cwd` | yes | Working directory. Must be an existing directory inside a registered project. A browser token is limited to its own project. |
| `prompt` | yes | The instruction. The overlay appends a `<frontend_context>` block. |
| `files` | no | Extra files to show the CLI. Each path must stay inside the root. Antigravity receives them as repeated `--file` arguments. |
| `sessionId` | no | Reuse an id. Codex uses it as `codex exec resume <id>`. Antigravity uses it as `--conversation`. |
| `yolo` | no | Cursor passes `--force` unless this is `false`. |
| `allowedTools` | no | Claude's `--allowedTools` list. The default is Read, Edit, Bash, Glob, and Grep. |
| `ephemeral` | no | Cursor-only cleanup of that session's worktree, described above. |
| `timeoutMs` | no | Overrides the 5 minute watchdog for this run. |

The schema also accepts `systemPrompt`. The adapters build their argv from `prompt`, `cwd`, tools, and the session id, so extra instructions belong in `prompt`.

### Errors

Failures before the process starts are HTTP errors. A CLI that exits non-zero after it has started still returns the event list; the `error` events carry the CLI's message.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `validation_error` | The JSON body does not match the schema. `issues` has the Zod details. |
| 401 | `unauthorized` | No bearer token, or the token is not the machine token or a live browser token. |
| 403 | `forbidden` | A browser token touched another project, or a WebSocket `Origin` is not registered. |
| 400 | `path_escape` | `cwd` or a file resolves outside the caller's project roots, or `cwd` is not a directory. |
| 400 | `invalid_cwd` | The directory disappeared between the check and process start. |
| 409 | `session_exists` | That `sessionId` is already registered. |
| 422 | `provider_unavailable` | The binary is missing, or the provider name is unknown. `setup` is a list of steps. |
| 422 | `cli_auth_required` | The CLI exited and its output asked for login. `setup` lists the sign-in steps. |
| 504 | `timeout` | The watchdog fired. The process was sent `SIGTERM`, then `SIGKILL`. |

A missing Antigravity CLI looks like this:

```json
{
  "error": "provider_unavailable",
  "message": "Antigravity CLI (`agy`) was not found.\n1. Install the Antigravity CLI so `agy` is on PATH.\n2. Run `agy` and finish sign-in.",
  "setup": [
    "Install the Antigravity CLI so `agy` is on PATH.",
    "Run `agy` and finish sign-in."
  ]
}
```

## Providers

`BinaryResolver` tries `which`, then a short list of install paths.

| Provider | Command it runs | Lookup order |
| --- | --- | --- |
| `cursor` | `agent -p --output-format stream-json --stream-partial-output --trust --workspace <cwd> --force -- "<prompt>"` | `agent`, `cursor-agent`, then `~/.local/bin` and `~/.cursor/bin` |
| `antigravity` | `agy --print "<prompt>" --output-format stream-json --workspace <cwd>` | `agy`, then `~/.local/bin` and `~/.antigravity/bin` |
| `claude` | `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools <list>` | `claude`, then `~/.local/bin` and `~/.claude/local` |
| `codex` | `codex exec --jsonl --sandbox workspace-write "<prompt>"` | `codex`, then `~/.local/bin` and `~/.npm-global/bin` |

Claude Code 2.1.173 rejects `stream-json` with `-p` unless `--verbose` is set. `--include-partial-messages` streams text deltas. `--permission-mode acceptEdits` lets the agent edit without a permission prompt. `--bare` is not passed: that flag skips OAuth and would require `ANTHROPIC_API_KEY`.

When `CURSOR_AUTH_TOKEN` and `CURSOR_API_KEY` are unset, the Cursor adapter reads the signed-in IDE access token from Cursor's local state database and passes it to that child as `CURSOR_AUTH_TOKEN`. The gateway does not write the token to disk or include it in logs. `agent login` remains the fallback when the IDE has no session.

Arguments are a discrete argv array. A prompt that contains `;`, `&&`, or quotes is one argument, not a shell command.

Each adapter turns that CLI's JSON or NDJSON into the same event types. Text becomes `chunk`. Tool invocations become `tool_call` and `tool_result`. File paths the CLI reports become `file_edit`.

## Environment

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `AIDEV_HOME` | `@aidev/gateway`, Vite plugin, `aidev` | `~/.aidev` | Token, `config.json`, pid file, and logs. Tests must point this at a temp directory. |
| `AIDEV_TOKEN` | example client | token file in `AIDEV_HOME` | Machine token override for scripts. |
| `HOST` | `@aidev/gateway` | `127.0.0.1` | Bind address. Loopback keeps the gateway off the network. |
| `PORT` | `@aidev/gateway` | `4100`, or `config.json` `port` | TCP port. `aidev start --port` writes the chosen port into config. |
| `GATEWAY_ROOT` | `@aidev/gateway` | unset | When set, that directory is auto-registered as a project root at startup. |
| `GATEWAY_URL` | Vite plugin, example client | `http://127.0.0.1:4100` | Gateway origin. The plugin injects this into the page. |
| `GATEWAY_LOG_LEVEL` | `@aidev/adapters` | `info` | `debug`, `info`, `warn`, `error`, or `silent`. Tests force `silent`. |
| `GATEWAY_PROVIDER` | example client | first detected CLI, preferring `antigravity` | Provider for `pnpm --filter @aidev/gateway client`. |
| `GATEWAY_CWD` | example client | the current directory | Working directory sent with that prompt. It has to sit inside a registered project. |
| `SHELL` | terminal bridge | the process shell, or `bash` | Shell spawned for the in-browser terminal. |

## `aidev`

The `@aidev/gateway` package ships a `bin` named `aidev` (Node's `util.parseArgs`, no extra parser).

| Command | What it does |
| --- | --- |
| `aidev start [--port N] [--detach]` | Listen on loopback. `--detach` respawns itself, writes `$AIDEV_HOME/gateway.pid`, and appends `$AIDEV_HOME/logs/gateway.log`. |
| `aidev stop` | Signals the pid file and removes it. |
| `aidev status` | Calls `/health` and `/api/v1/status` with the machine token and prints projects, active runs, and providers. |
| `aidev doctor` | Prints each provider's availability, binary path, and `<bin> --version`. |
| `aidev projects add <path> [--origin URL]` | Registers the root over HTTP when the gateway is up, otherwise writes it into `config.json`. |
| `aidev open` | Prints `http://127.0.0.1:<port>/` and opens it. That page is a placeholder until the dashboard exists. |

There is no API-key variable. Each CLI keeps its own login.

`pnpm --filter @aidev/gateway dev` does not authorize the git toplevel by itself. Register each repo you want the CLIs to edit (`aidev projects add`, the Vite plugin, or `GATEWAY_ROOT`). A prompt whose `cwd` is outside those roots is `path_escape`.

## Safeguards

- **Loopback.** The default bind is `127.0.0.1`. Set `HOST` only when you intend the port to be reachable from somewhere else.
- **Machine token.** The first start writes `~/.aidev/token` (mode `0600`, 32 random bytes, base64url). Every `/api/v1/*` route and every WebSocket requires `Authorization: Bearer <token>` or `?token=`. `GET /health` stays open and returns only `{ status, version }`.
- **Browser tokens.** `POST /api/v1/projects/register` (machine token) takes `{ root, origin }` and returns `{ projectId, browserToken }`. The browser token lives in memory, is scoped to that project, and is re-issued when the dev server registers again after a restart. Re-registering the same root keeps the project id and may add an origin.
- **CORS.** `Access-Control-Allow-Origin` is set only for origins registered by a project (and the gateway's own origin after it binds). Any other `Origin`, including `https://evil.example`, gets no CORS header. Requests with no `Origin` (curl, Node) are allowed when the token is valid. A WebSocket upgrade with a non-allowlisted `Origin` is rejected.
- **Project roots.** A machine token may use a `cwd` inside any registered project. A browser token may use only its own. Paths are realpath-checked, including symlinks. `GATEWAY_ROOT` only auto-registers that one root; it is not an implicit allow-all.
- **Git.** Diff paths are canonicalized and confined to the project. An untracked symlink is shown as a symlink; its target is not read. Discard deletes only the untracked paths that were explicitly listed.
- **Terminal.** PTY spawn requires a token that can access the project. The child environment drops variables matching `TOKEN`, `SECRET`, `KEY`, or `PASSWORD`, and keeps `PATH`-like names. `allowRemoteShell` defaults to false; on loopback the token check is what gates the shell.
- **No shell for CLIs.** Adapter `spawn` is called with `shell: false`. `which` is `execFile`, and command names that contain shell metacharacters are ignored.
- **Watchdog.** The default timeout is 5 minutes (`timeoutMs` overrides it). On expiry the process group receives `SIGTERM`, then `SIGKILL` if it is still alive.
- **Reload debounce.** The file watcher waits for writes to settle. Holding `full-reload` until a prompt ends is wired to the socket prompt listener. Toolbar chat does not use that listener, so it does not hold reloads.

## Troubleshooting

**The toolbar never appears.** The plugin is off for `vite build` and for `aiDevtools({ enabled: false })`. Restart `vite` after `pnpm build` so it picks up the overlay bundle. The page source should contain `/@ai-devtools/overlay.js`.

**The status dot stays idle.** The gateway is not reachable at the injected URL. Start `@aidev/gateway`, or set `GATEWAY_URL`. Toolbar chat calls the gateway directly, so prompts do not run while it is down.

**`provider_unavailable`.** The binary is not on `PATH` and not in the lookup paths above. The response `setup` array is the short version of what to install and which command to run once so the CLI can sign in.

**`cli_auth_required`.** The process started and then asked for login. For Cursor, sign in to the Cursor app and retry, or run `agent login`. Other CLIs need their own sign-in in a normal terminal. The gateway does not store credentials.

**`path_escape`.** `cwd` or a `files` entry resolved outside the registered projects (or outside the browser token's project). Register the repo with `aidev projects add` or `GATEWAY_ROOT`. The Vite plugin registers the directory it serves.

**`unauthorized`.** The request had no bearer token. Read `~/.aidev/token` (or `AIDEV_TOKEN`) and send it as `Authorization: Bearer`. WebSocket clients can use `?token=` instead.

**Commit fails with "not a git repository".** The Vite root is not inside a work tree. Initialize git there, or run the app from a subdirectory of a repository. The Lumen end-to-end test copies the demo into a temporary repository for this reason.
