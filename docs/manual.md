# Manual

This is the operator's guide for the gateway and the in-browser overlay: how to run the Lumen demo, how to drop the toolbar into another Vite app, and how to call the HTTP API yourself.

## The loop

The overlay collects context in the page. The Vite plugin forwards the prompt to the gateway. The gateway runs one already-authenticated CLI in the project directory and normalizes its output into a single event stream. The CLI writes files on disk. Vite hot-reloads them. You commit from the drawer.

```
browser overlay  →  Vite dev socket  →  gateway :4100  →  agent | agy | claude | codex
        ↑                                        |
        └──────── stream events, git, PTY, tests ┘
```

If the gateway process is down, the Vite plugin runs the same adapter in-process through `@gateway/core` and still streams events to the drawer.

## Run the Lumen demo

From the repository root, in two terminals:

```bash
pnpm install
pnpm build
pnpm --filter @gateway/server dev
```

```bash
pnpm demo
```

Open http://127.0.0.1:5173. The toolbar is injected in development only.

![The Lumen storefront and the AI DevTools toolbar](images/lumen-storefront.png)

Lumen is a small storefront: a header, a hero, a quantity counter, product cards, a note form with validation, and a diagnostics panel that can log a warning, log an error, or throw. Those pieces give the inspector something real to select.

Confirm which CLIs the gateway can see:

```bash
curl -s http://127.0.0.1:4100/health
```

```json
{
  "status": "ok",
  "timestamp": 1760990000000,
  "availableProviders": [
    { "provider": "cursor", "available": true, "binaryPath": "/Users/you/.local/bin/agent" },
    { "provider": "antigravity", "available": false, "binaryPath": null },
    { "provider": "claude", "available": true, "binaryPath": "/opt/homebrew/bin/claude" },
    { "provider": "codex", "available": false, "binaryPath": null }
  ]
}
```

`GET /api/v1/providers` returns the same list under `providers`. Choose a provider whose `available` is `true`.

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

Suggestions ("Fix layout", "Make responsive", "Add hover state") only fill the box. Send with the button or with Cmd/Ctrl+Enter. **Stop** cancels the running session.

A dirty or conflicted git tree is reported as a warning in the chat before the agent starts. The prompt still runs. After the agent edits files, a notice offers **Review diffs**.

### Diffs

**Diffs** lists staged, unstaged, and untracked files inside the Vite project. Each file shows additions and deletions. The hunk view is the unified diff.

![The diff viewer on a one-line hero button edit](images/lumen-diffs.png)

Type a commit message and click **Commit Changes**. "Push to origin" pushes the current branch after the commit succeeds. **Discard** asks for confirmation, then restores tracked files and removes untracked files that the summary listed. Paths that leave the project directory are rejected.

The badge on the toolbar is the number of files in the summary.

### Terminal

**Terminal** starts `$SHELL` (or `bash`) in the Vite project directory and connects it to an xterm.js pane. `node-pty` is used when its native binding loads. If it does not, the plugin falls back to a piped interactive shell.

![A shell session in the demo directory](images/lumen-terminal.png)

Closing the panel disposes that session. The shell is the same user as the Vite process, so it can run git, pnpm, and the project scripts.

### Tests

**Tests** runs the project's `test` script. It walks up from the Vite root and prefers pnpm (`pnpm-lock.yaml` or `pnpm-workspace.yaml`), then npm, then yarn. With no script, a project that depends on Vitest runs `npx vitest run`. Output streams into the panel. The badge reads Passed or Failed from the exit code.

![The test runner after the Lumen suite passed](images/lumen-tests.png)

Starting another run aborts the one in progress.

## Add the overlay to a Vite app

Install the workspace package, or depend on `@ai-devtools/vite-plugin` from this repo, and register it:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiDevtools } from '@ai-devtools/vite-plugin';

export default defineConfig({
  plugins: [react(), aiDevtools()],
});
```

During `serve` the plugin does four things:

1. Injects a config script and `<script type="module" src="/@ai-devtools/overlay.js">` into `<head>`. The config is `globalThis.__AI_DEVTOOLS__`: the Vite WebSocket token, the gateway URL, and the project root used as `cwd`.
2. Serves the overlay bundle from `@devtools/overlay`.
3. Writes `data-loc` onto JSX elements that do not already have one. The column is Babel's 0-based column.
4. Handles overlay messages on Vite's HMR socket: prompts, cancel, git diff, commit, revert, PTY, and tests.

`aiDevtools()` accepts:

| Option | Default | Effect |
| --- | --- | --- |
| `gatewayUrl` | `GATEWAY_URL` or `http://127.0.0.1:4100` | Where prompts are forwarded. |
| `enabled` | `true` while serving, `false` for builds | Turns injection and the socket bridge off. |
| `injectDataLoc` | `true` | Turns the JSX source stamp off. |

The file watcher waits briefly for a write to finish, and full page reloads are held until the current prompt settles, then sent once. Module hot updates still apply as files change.

Start the gateway in the repo you want the CLI to edit, or set `GATEWAY_ROOT` to that repo. The overlay's `cwd` is the Vite root, and both the plugin and the gateway reject a path that resolves outside the authorized root, including a symlink whose target is outside it.

## Call the gateway directly

The server listens on `127.0.0.1:4100` unless `HOST` and `PORT` say otherwise.

### One-shot prompt

`POST /api/v1/prompt` runs the CLI and returns when it exits.

```bash
curl -s http://127.0.0.1:4100/api/v1/prompt \
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
curl -N http://127.0.0.1:4100/api/v1/sessions/sess_01H.../stream
```

Each frame is one unified event:

```
event: chunk
data: {"id":"...","sessionId":"sess_01H...","type":"chunk","timestamp":1760990000000,"payload":{"text":"Hello"}}

event: done
data: {"id":"...","sessionId":"sess_01H...","type":"done","timestamp":1760990001000,"payload":{"durationMs":812}}
```

`GET /api/v1/sessions/:id` returns the session record, including events already buffered. `DELETE /api/v1/sessions/:id` aborts a running session.

`ephemeral: true` asks the Cursor adapter to delete `.cursor/worktrees/<sessionId>` and `.cursor/sessions/<sessionId>` after the process exits. Other providers ignore it.

### WebSocket

Connect to `ws://127.0.0.1:4100/ws`.

```json
{ "type": "prompt", "provider": "antigravity", "cwd": "/path/to/app", "prompt": "Tighten the hero spacing", "yolo": true }
```

The server replies with `{ "type": "ready", "sessionId": "..." }`, then `{ "type": "event", "event": { ... } }` for each stream event. Cancel with `{ "type": "cancel", "sessionId": "..." }`.

### Prompt fields

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | `cursor`, `antigravity`, `claude`, or `codex`. |
| `cwd` | yes | Working directory. Must be an existing directory inside `GATEWAY_ROOT`. |
| `prompt` | yes | The instruction. The overlay appends a `<frontend_context>` block. |
| `files` | no | Extra files to show the CLI. Each path must stay inside the root. Antigravity receives them as repeated `--file` arguments. |
| `sessionId` | no | Reuse an id. Codex uses it as `codex exec resume <id>`. Antigravity uses it as `--conversation`. |
| `yolo` | no | Cursor passes `--force` unless this is `false`. |
| `allowedTools` | no | Claude's `--allowedTools` list. The default is Read, Edit, Bash, Glob, and Grep. |
| `ephemeral` | no | Cursor-only cleanup of that session's worktree, described above. |

The schema also accepts `systemPrompt`. The adapters build their argv from `prompt`, `cwd`, tools, and the session id, so extra instructions belong in `prompt`.
| `timeoutMs` | no | Overrides the 5 minute watchdog for this run. |

### Errors

Failures before the process starts are HTTP errors. A CLI that exits non-zero after it has started still returns the event list; the `error` events carry the CLI's message.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `validation_error` | The JSON body does not match the schema. `issues` has the Zod details. |
| 400 | `path_escape` | `cwd` or a file resolves outside `GATEWAY_ROOT`, or `cwd` is not a directory. |
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
| `claude` | `claude --bare -p "<prompt>" --output-format stream-json --allowedTools <list> --permission-prompts none` | `claude`, then `~/.local/bin` and `~/.claude/local` |
| `codex` | `codex exec --jsonl --sandbox workspace-write "<prompt>"` | `codex`, then `~/.local/bin` and `~/.npm-global/bin` |

When `CURSOR_AUTH_TOKEN` and `CURSOR_API_KEY` are unset, the Cursor adapter reads the signed-in IDE access token from Cursor's local state database and passes it to that child as `CURSOR_AUTH_TOKEN`. The gateway does not write the token to disk or include it in logs. `agent login` remains the fallback when the IDE has no session.

Arguments are a discrete argv array. A prompt that contains `;`, `&&`, or quotes is one argument, not a shell command.

Each adapter turns that CLI's JSON or NDJSON into the same event types. Text becomes `chunk`. Tool invocations become `tool_call` and `tool_result`. File paths the CLI reports become `file_edit`.

## Environment

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | `@gateway/server` | `127.0.0.1` | Bind address. Loopback keeps the gateway off the network. |
| `PORT` | `@gateway/server` | `4100` | TCP port. |
| `GATEWAY_ROOT` | `@gateway/server` | Git toplevel of the server process, or its current directory | Prompt `cwd` and file paths must stay inside this directory. |
| `GATEWAY_URL` | Vite plugin, example client | `http://127.0.0.1:4100` | Gateway origin. The plugin injects this into the page. |
| `GATEWAY_LOG_LEVEL` | `@gateway/core` | `info` | `debug`, `info`, `warn`, `error`, or `silent`. Tests force `silent`. |
| `GATEWAY_PROVIDER` | example client | first detected CLI, preferring `antigravity` | Provider for `pnpm --filter @gateway/server client`. |
| `GATEWAY_CWD` | example client | the current directory | Working directory sent with that prompt. It still has to sit inside `GATEWAY_ROOT`. |
| `SHELL` | terminal bridge | the process shell, or `bash` | Shell spawned for the in-browser terminal. |

There is no API-key variable. Each CLI keeps its own login.

`pnpm --filter @gateway/server dev` runs with the package directory as its working directory. The authorized root is still the git toplevel, so a prompt whose `cwd` is `apps/demo-react-app` is accepted. Set `GATEWAY_ROOT` when the server should be allowed to edit a different checkout.

## Safeguards

- **Loopback.** The default bind is `127.0.0.1`. Set `HOST` only when you intend the port to be reachable from somewhere else.
- **Project root.** `cwd` and every file path are resolved, symlinks included, and rejected when they leave `GATEWAY_ROOT`. The Vite plugin does the same against the project it is serving, so a page cannot point a prompt at `/etc`.
- **No shell.** `spawn` is called with `shell: false`. `which` is `execFile`, and command names that contain shell metacharacters are ignored.
- **Watchdog.** The default timeout is 5 minutes (`timeoutMs` overrides it). On expiry the process group receives `SIGTERM`, then `SIGKILL` if it is still alive.
- **Git scope.** Commit and discard only touch paths inside the Vite project. A conflicted or dirty tree produces a warning chunk before the agent runs.
- **Reload debounce.** During a prompt, Vite `full-reload` messages are queued and delivered once, 250ms after the last one, when the prompt ends. The file watcher also waits for writes to settle.

## Troubleshooting

**The toolbar never appears.** The plugin is off for `vite build` and for `aiDevtools({ enabled: false })`. Restart `vite` after `pnpm build` so it picks up the overlay bundle. The page source should contain `/@ai-devtools/overlay.js`.

**The status dot stays idle.** The gateway is not reachable at the injected URL. Start `@gateway/server`, or set `GATEWAY_URL`. Prompts still run in-process when the server is down; health checks do not.

**`provider_unavailable`.** The binary is not on `PATH` and not in the lookup paths above. The response `setup` array is the short version of what to install and which command to run once so the CLI can sign in.

**`cli_auth_required`.** The process started and then asked for login. For Cursor, sign in to the Cursor app and retry, or run `agent login`. Other CLIs need their own sign-in in a normal terminal. The gateway does not store credentials.

**`path_escape`.** `cwd` or a `files` entry resolved outside the authorized root. For the demo, `cwd` should be the `apps/demo-react-app` directory (the plugin injects this). For a server started outside a git checkout, set `GATEWAY_ROOT` to the checkout you want to allow.

**The page reloads once at the end of a long edit.** That is the reload guard releasing a full reload after the prompt. Hot updates to modules still apply while the agent is writing.

**Commit fails with "not a git repository".** The Vite root is not inside a work tree. Initialize git there, or run the app from a subdirectory of a repository. The Lumen end-to-end test copies the demo into a temporary repository for this reason.
