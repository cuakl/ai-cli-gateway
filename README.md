# AI CLI Gateway

A pnpm monorepo that runs already-authenticated local agent CLIs behind one HTTP and WebSocket API, and a browser DevTools overlay that can inspect a page, send an edit prompt, stream the reply, and commit the result.

The overlay does not need an LLM API key. It uses the CLIs already logged in on the machine: Cursor (`agent`), Antigravity (`agy`), Claude Code (`claude`), and Codex (`codex`).

## Requirements

- Node.js 20 or newer
- pnpm 10 (`packageManager` is `pnpm@10.7.1`)
- Git
- At least one of `agent`, `agy`, `claude`, or `codex` on `PATH` when you want a real model. The automated end-to-end test uses a scripted provider and does not need a CLI.

## Setup

From the repository root:

```bash
pnpm install
pnpm build
pnpm test
```

`pnpm build` compiles the packages and the overlay bundle the Vite plugin injects. `pnpm test` runs every package that defines a test script.

## Run the demo

Start the gateway, then the Lumen demo. Each command stays in the foreground.

```bash
pnpm --filter @gateway/server dev
```

```bash
pnpm demo
```

Open http://127.0.0.1:5173. The AI DevTools toolbar is injected in development only; production builds leave it out.

1. Click **Inspect**, then click the hero button ("Add the lamp"). The chat chip shows the component and source location.
2. Choose a provider that `GET /health` reports as available.
3. Ask for a change, for example: "Change the hero button to purple with rounded-full styling".
4. Watch the reply stream in the chat drawer. The CLI edits the demo files, and Vite hot-reloads the page.
5. Open **Diffs**, review the hunks, enter a commit message, and click **Commit Changes**. Leave "Push to origin" off unless you intend to push.
6. **Terminal** opens a shell in the demo directory. **Tests** runs `pnpm test` for the demo.

The prompt includes the selected element, its source location, recent console errors, and failed network requests. The gateway receives the demo directory as `cwd`, which the Vite plugin injects into the page.

You can also stream a prompt from the terminal:

```bash
pnpm --filter @gateway/server dev
pnpm --filter @gateway/server client -- "Add a hover transition to the hero button"
```

## End-to-end test

```bash
pnpm e2e
```

This builds the gateway, the Vite plugin, and the overlay, copies the demo into a temporary git repository, and drives the browser through the loop above. A scripted provider applies the hero-button edit, so the test does not call a real model and does not commit in this repository. The first run may download Playwright's browser if Google Chrome is not installed.

The demo's own Vitest suite is part of `pnpm test`:

```bash
pnpm --filter demo-react-app test
```

## Environment variables

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | `@gateway/server` | `127.0.0.1` | Bind address. Loopback keeps the gateway off the network. |
| `PORT` | `@gateway/server` | `4100` | TCP port. |
| `GATEWAY_ROOT` | `@gateway/server` | git root of the server process, or its current directory | Prompt `cwd` and file paths must stay inside this directory. |
| `GATEWAY_URL` | Vite plugin, example client | `http://127.0.0.1:4100` | Gateway origin. The plugin injects this into the overlay. |
| `GATEWAY_LOG_LEVEL` | `@gateway/core` | `info` | One of `debug`, `info`, `warn`, `error`, `silent`. Test runs are silent. |
| `GATEWAY_PROVIDER` | example client | first detected CLI, preferring `antigravity` | Provider for `pnpm --filter @gateway/server client`. |
| `GATEWAY_CWD` | example client | the current directory | Working directory sent with that prompt. |
| `SHELL` | terminal bridge | the process shell, or `bash` | Shell spawned for the in-browser terminal. |

There is no API-key variable. Authentication stays inside each CLI's own login.

## Packages

```
ai-cli-gateway/
├── packages/
│   ├── shared-types/       # @gateway/shared-types
│   ├── gateway-core/       # @gateway/core
│   ├── gateway-server/     # @gateway/server
│   ├── devtools-overlay/   # @devtools/overlay
│   └── devtools-vite/      # @ai-devtools/vite-plugin
├── apps/
│   └── demo-react-app/     # Lumen storefront used to exercise the overlay
└── examples/
    └── gateway-client/     # Streams one prompt against a running gateway
```

### `@gateway/shared-types`

Zod schemas and the TypeScript types inferred from them: `ProviderType`, `PromptOptions`, `UnifiedStreamEvent` (`init`, `chunk`, `tool_call`, `tool_result`, `file_edit`, `error`, `done`), `FrontendContextPayload`, `GitDiffSummary`, and `GitCommitRequest`.

### `@gateway/core`

`BaseAdapter` resolves the CLI, validates the prompt, and supervises the child through `ProcessManager`. Arguments are an argv array, never a shell string. A hung process is stopped with `SIGTERM`, then `SIGKILL` after a short grace period. The default run timeout is 5 minutes.

`BinaryResolver` looks up each provider with `which`, then common install paths. Cursor is `agent` (then `cursor-agent` and `cursor`). Antigravity is `agy`, Claude Code is `claude`, and Codex is `codex`.

### `@gateway/server`

Fastify on `127.0.0.1:4100`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{ status: "ok", availableProviders }` |
| `GET` | `/api/v1/providers` | The same provider list |
| `POST` | `/api/v1/prompt` | Run a prompt and return when it finishes |
| `POST` | `/api/v1/sessions` | Start a session and return `{ sessionId, streamUrl }` |
| `GET` | `/api/v1/sessions/:id/stream` | Server-Sent Events of unified stream events |
| `DELETE` | `/api/v1/sessions/:id` | Abort a running session |
| `GET` | `/ws` | WebSocket for the same prompt and cancel messages |

### `@devtools/overlay`

A custom element, `<ai-devtools>`, rendered in an open shadow root. It can pick an element without firing the page's click handlers, read React Fiber `_debugSource` or a `data-loc` attribute, capture a screenshot, and keep a ring buffer of console errors. The drawer has chat, diffs, a terminal, and a test runner.

### `@ai-devtools/vite-plugin`

`aiDevtools()` in a Vite config, during `serve` only:

- injects the overlay script and `globalThis.__AI_DEVTOOLS__` (`wsToken`, `gatewayUrl`, and the project `cwd`)
- stamps `data-loc="file:line:col"` onto JSX
- bridges git, the PTY, and `pnpm test` over Vite's HMR socket
- forwards prompts to `GATEWAY_URL`, and falls back to `@gateway/core` in-process when that server is down

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiDevtools } from '@ai-devtools/vite-plugin';

export default defineConfig({
  plugins: [react(), aiDevtools()],
});
```

Put `aiDevtools()` before the JSX compiler. The plugin reorders itself ahead of `@vitejs/plugin-react` when it can.

### `demo-react-app`

A small storefront with a header, hero, quantity counter, product cards, a note form with validation, and buttons that emit console warnings and errors. Those pieces give the inspector something real to select.

## Safeguards

- The gateway binds to loopback unless `HOST` is set.
- Prompt `cwd` and file paths must stay inside `GATEWAY_ROOT`. The Vite bridge applies the same check against the project it is serving.
- CLI arguments are passed as an array to `spawn`, not concatenated into a shell command. A hung process is stopped with `SIGTERM`, then `SIGKILL`. The default limit is 5 minutes.
- The git bridge only stages paths inside the Vite project root. A dirty or conflicted tree is reported in the chat before the agent edits.
- While a prompt is running, full page reloads are collapsed into one refresh so multi-file edits do not thrash the browser.
- A missing or unauthenticated CLI returns a structured error with setup steps instead of an empty crash.
