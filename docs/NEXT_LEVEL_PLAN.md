# Next-level plan

This plan takes the project from "the demo loop works" to a tool you would install in a real frontend and reach for every day. It supersedes `IMPLEMENTATION_PLAN.md` for all new work; that file stays as history.

It is written for implementing agents (Grok 4.7 in Cursor). Every phase lists the files to touch, the contracts to honor, and acceptance criteria that must be checked before the phase is called done. Read sections 1–4 before starting any phase.

---

## 1. Where the project is today

Audited on 2026-10-23 with code reads, `pnpm test` (161 tests passing), a live run of the gateway and the Lumen demo, and one real Cursor prompt through the overlay.

### What works

- Inspect → prompt → Cursor edits → Vite hot-reloads → Diffs → Discard/Commit runs end to end.
- Path confinement (realpath, symlinks), `spawn` without a shell, the watchdog, SSE replay, and the Cursor stream-json parser are careful and tested.
- Shadow-DOM isolation, the `data-loc` JSX stamper, React Fiber lookup, and the terminal and test bridges are a credible core.

### Drift from the original idea

The original idea had two products, the second built on the first:

1. **A gateway for AI coding CLIs**, used by the overlay *and* for "quick prototyping of AI features (inference) in other projects without API keys". Sessions are created per request, streamed back, and optionally deleted (or kept for debugging).
2. **An agnostic in-browser devtools package** that handles the whole loop: rich context (selection, screenshots, console/errors), code review, commit and push, tests, and a terminal.

What got built is mostly product 2 wired to a gateway that only serves product 2:

| Original intent | Today |
| --- | --- |
| Inference for other projects | No read-only mode. `cwd` is required and must sit under one `GATEWAY_ROOT`. Every run has write tools on (`--force`, Claude `Edit,Bash`, Codex `workspace-write`). No model choice, no system prompt (accepted and ignored), no structured output, no OpenAI-compatible endpoint, no client package. |
| Create session → stream → optionally delete or keep | Sessions are in-memory and expire after 10 minutes. No list. "Ephemeral" deletes `<cwd>/.cursor/worktrees/<gatewayId>`, which `agent -p` never creates. Provider chat ids are parsed and dropped, so nothing can be resumed or deleted. |
| Agnostic across CLIs | Cursor works. The Claude adapter passes `--permission-prompts none`, which Claude Code 2.1.173 rejects (`unknown option`), so **Claude is broken**. It also passes `--bare`, which disables OAuth login, contradicting "no API keys". Antigravity and Codex argv were never run against real binaries; the mocks only confirm the adapter agrees with itself. |
| Easy to install in frontend projects | Every package is `private` with `workspace:*` dependencies spread over three scopes (`@gateway`, `@devtools`, `@ai-devtools`). The gateway must be started separately, rooted at the project. Only Vite + JSX is supported. |
| Rich context | Collected, then mostly lost. The screenshot is reduced to `screenshotIncluded: true` and the bytes never reach the CLI. Console and errors are attached silently, with no UI. Only `fetch` failures are captured. Vite compile errors and error-boundary errors are ignored. |
| End-to-end workflow | Chat bypasses the Vite bridge (`App.tsx` calls `GatewayClient` directly). The dirty-tree warning, the reload guard, and the in-process fallback described in the manual never run. Each Send is a fresh CLI process with no memory of the thread. A full reload wipes the conversation. No undo per run, no per-file commit, no AI commit message, no PR. |

### UI/UX problems seen live

Ordered by how much they hurt.

1. Panels are floating cards (420×640 chat, 880×640 diffs/terminal/tests) that cover the page mid-screen. At 390px the toolbar clips its own brand and covers content.
2. The transcript is a plain string. Markdown shows as raw backticks, streamed segments run together ("`Hero.tsx`.The hero…"), and tool rows never resolve (no done/failed state, no args or results).
3. The inspector labels DOM nodes (`button#hero-btn.btn.primary (130x44)`), not components. A nested click jumps to an ancestor component with no way to walk parents. The label covers nearby text.
4. Console warnings, errors, and thrown exceptions produce no badge and no "fix this" affordance.
5. Diff: old and new line numbers touch ("1111"). Long lines clip with no scrollbar (a flex child is missing `min-width: 0`). There is no syntax highlighting, no split view, and no per-file or per-hunk control.
6. Uninstalled providers can be selected and sent. The hint wraps badly. Send stays enabled.
7. Suggestion chips are generic, ignore the selection, overwrite the draft, and linger after the run.
8. Empty states are one grey line in a 640px void while the commit chrome is still shown.
9. Switching tabs unmounts the terminal and kills the shell. Tests have no Stop and hang forever on watch-mode scripts. The Tests panel kicker is hard-coded to "Demo suite".
10. Type is 12–13px with 10–11px labels. There are no design tokens, no responsive rules, no focus management, and unlabeled `✕` buttons.

### Security holes (must fix before anyone else uses this)

- Gateway CORS reflects any origin (`app.ts` `origin: true`), `/ws` does not check `Origin`, and there is no token. Any website open in the browser can drive a CLI with `--force` inside `GATEWAY_ROOT`.
- The terminal is a full shell for anyone holding the Vite HMR token, which is in the page HTML. The PTY inherits the whole Vite environment.
- The git service's path check is lexical (`..`, absolute), not realpath. Untracked symlink targets are read into the diff. Discard runs `git clean` on every untracked path in the summary.

---

## 2. Target architecture

### 2.1 One companion process, thin bundler plugins

Today, logic is split between the gateway (CLI runs) and the Vite plugin (git, PTY, tests, a second prompt runner). The overlay talks to both over two sockets. Collapse that:

```
browser overlay (framework-agnostic IIFE, shadow DOM)
      │  HTTPS-less loopback, project-scoped token
      ▼
companion = the gateway  (one per machine, 127.0.0.1:4100)
  ├─ projects     registry of allowed roots + their dev-server origins
  ├─ runs/threads CLI adapters, persistent transcripts, checkpoints
  ├─ workspace    git, PTY, tests (moved out of devtools-vite)
  ├─ inference    /v1/chat/completions, /api/v1/infer (read-only, scratch dir)
  └─ dashboard    small web UI at http://127.0.0.1:4100/
      ▲
      │ register project, get browser token, subscribe to run events
bundler plugin (Vite today; Next/webpack later)
  - injects <script> + config (gateway URL, projectId, browser token)
  - stamps data-loc
  - holds full reloads while a run is active (via gateway events)
  - auto-starts the companion if it is not running
```

Consequences:

- The overlay has exactly one backend. No more "chat goes one way, git goes another".
- The in-process fallback runner in `devtools-vite/src/bridge.ts` is deleted. The plugin auto-starts the companion instead.
- `node-pty`, `simple-git`, and the adapters leave the frontend dependency tree.
- Any framework can integrate by injecting one script tag and obtaining a token.

### 2.2 Packages after the refactor

The product name is not decided. Use a placeholder scope `@aidev/*` and keep the scope, the CLI binary name (`aidev`), the custom element (`<aidev-toolbar>`), and the dotfolder (`~/.aidev`) in **one constants module** per package so a rename is a find-and-replace. Ask the owner before publishing.

| New package | From | Contents |
| --- | --- | --- |
| `@aidev/protocol` | `@gateway/shared-types` | Zod schemas for every HTTP/WS message, events, threads, runs, projects, context. Has its own tests. |
| `@aidev/adapters` | `@gateway/core` | CLI adapters, binary resolver, process manager, capability matrix. |
| `@aidev/gateway` | `@gateway/server` + git/pty/test services from `devtools-vite` | Fastify server, store, workspace services, inference routes, dashboard static files. Has a `bin` (`aidev`). |
| `@aidev/overlay` | `@devtools/overlay` | Browser IIFE plus an ESM `mount()` for advanced users. `./overlay.js` is an exported subpath. |
| `@aidev/vite` | `@ai-devtools/vite-plugin` | Injection, `data-loc`, reload hold, companion auto-start. No `node-pty`. |
| `@aidev/client` | new | Tiny fetch-based SDK for inference (`generate`, `stream`, `generateObject`). Zero deps except `@aidev/protocol` types. |

Do the rename as its own commit in Phase 1, with no behavior change, so later diffs stay readable.

### 2.3 Auth model

- On first start the gateway creates `~/.aidev/token` (mode `0600`, 32 random bytes, base64url). This is the **machine token**. Any process run by the same user can read it: the Vite plugin, `@aidev/client`, and the CLI.
- `POST /api/v1/projects/register` (machine token required) takes `{ root, origin }` and returns `{ projectId, browserToken }`. The browser token is random, scoped to that project, and kept in memory (re-registered on gateway restart; the plugin retries).
- All `/api/v1/*`, `/v1/*`, and WS routes require `Authorization: Bearer <token>`, or `?token=` for WebSocket. `GET /health` stays open and only reports `{ status, version }`.
- CORS allows only origins registered by projects, plus the dashboard's own origin. `/ws` and the project WebSocket reject an `Origin` not in that set.
- A browser token can only touch its project's root: runs, git, PTY, and tests are confined to it.
- PTY spawn requires a browser token *and* the dev server bound to loopback, unless the project was registered with `allowRemoteShell: true`. The PTY environment drops variables that match `/(TOKEN|SECRET|KEY|PASSWORD)/i`, except `PATH`-like ones.
- Inference routes (`/v1/*`) accept the machine token or a token listed in `~/.aidev/config.json` `inferenceTokens`, so another project can keep its own key in `.env`.

### 2.4 Data model (put these in `@aidev/protocol` first)

```ts
type Provider = 'cursor' | 'claude' | 'codex' | 'antigravity';
type RunMode = 'agent' | 'ask' | 'plan';           // ask/plan = read-only

interface ProviderCapabilities {
  provider: Provider;
  available: boolean;
  binaryPath: string | null;
  version: string | null;            // from `<bin> --version`
  verified: boolean;                 // argv contract tested against this version (see 3.3)
  modes: RunMode[];
  models: { id: string; label: string }[];   // cursor: `agent --list-models`; claude: aliases
  supportsResume: boolean;
  supportsImages: boolean;
  supportsJsonSchema: boolean;
  supportsSystemPrompt: boolean;
  setup?: string[];                  // shown when !available or signed out
}

interface Project {
  id: string;                        // stable hash of realpath(root)
  root: string;
  name: string;                      // package.json name or basename
  origins: string[];
  createdAt: number;
  lastSeenAt: number;
}

interface Thread {
  id: string;                        // thr_...
  projectId: string | null;          // null for inference threads
  provider: Provider;
  model: string | null;
  mode: RunMode;
  providerSessionId: string | null;  // the CLI's own chat id, captured from its init event
  title: string;                     // first prompt, truncated; can be renamed
  createdAt: number;
  updatedAt: number;
  keep: boolean;                     // false = eligible for retention cleanup
  source: 'overlay' | 'api' | 'openai' | 'dashboard';
}

interface Run {
  id: string;                        // run_...
  threadId: string;
  prompt: string;                    // what the user typed
  contextSummary: ContextSummary | null;   // chips that were attached (no raw image bytes)
  attachments: { kind: 'image'; path: string; mime: string }[];
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  startedAt: number;
  endedAt: number | null;
  checkpoint: { ref: string; baseHead: string; dirtyBefore: string[] } | null;
  filesTouched: string[];
  error: { code: string; message: string; setup?: string[] } | null;
  usage: { durationMs: number; inputTokens?: number; outputTokens?: number } | null;
}
```

Stream events keep the current unified shape (`init`, `chunk`, `tool_call`, `tool_result`, `file_edit`, `error`, `done`). Add these:

- `session_info { providerSessionId, model }`, emitted when the adapter sees the CLI's own id.
- `tool_call` / `tool_result` gain a stable `toolCallId` so the UI can pair them. Use the CLI's id when there is one, otherwise a generated id carried until the matching result.
- `chunk` gains `segment: number`. The adapter increments it whenever a tool call interrupts text, so the UI can insert paragraph breaks. This fixes the "`Hero.tsx`.The hero…" glue.
- `checkpoint { ref }` and `files_changed { files }`, emitted by the gateway (not the adapter) around agent runs.
- Exactly one `done` per run, emitted by the gateway after the process exits. Adapters must not emit their own `done` (today Cursor emits two).

### 2.5 Storage

`~/.aidev/` (override with `AIDEV_HOME`):

```
token                     machine token (0600)
config.json               { port, projects: [...], inferenceTokens, retentionDays, defaultProvider, defaultModel, maxConcurrentRuns }
threads/<threadId>.json   Thread + Run[] metadata
threads/<threadId>.jsonl  raw unified events, append-only
scratch/<runId>/          empty cwd for inference runs; deleted after the run unless keep
attachments/<runId>/      screenshots and other images passed to CLIs
logs/gateway.log          rotated at 5 MB × 3
```

Use plain JSON/JSONL files, not `node:sqlite` (Node 20 lacks it). Writes are append or atomic rename. A `ThreadStore` interface hides this so it can move to SQLite later.

Retention: on startup and every hour, delete threads with `keep: false` older than `retentionDays` (default 7). "Ephemeral" requests set `keep: false` and also ask the provider to forget the chat (section 3.4).

---

## 3. Gateway work in detail

### 3.1 Workspace WebSocket (replaces Vite custom events)

`GET /api/v1/projects/:projectId/ws?token=…` carries one multiplexed JSON protocol. Every message is `{ type, requestId?, ... }`. Define all of them in `@aidev/protocol/workspace.ts`.

Client → gateway:

- `run.start { threadId?, provider, model?, mode, prompt, context, attachments[] }` → reply `run.accepted { threadId, runId }`, then `run.event { runId, event }` messages.
- `run.cancel { runId }`
- `thread.list`, `thread.get { threadId }`, `thread.delete { threadId }`, `thread.keep { threadId, keep }`
- `git.status`, `git.diff { paths? }`, `git.commit { message, paths, push }`, `git.discard { paths }`, `git.checkpoint.restore { runId }`, `git.log { limit }`, `git.branch.create { name }`, `git.pr.create { title, body, base }`
- `pty.spawn { cols, rows }`, `pty.input`, `pty.resize`, `pty.dispose`
- `test.run { file?, watch? }`, `test.stop`
- `commit.suggest { paths }` → an inference run that drafts a commit message (section 3.5)

Gateway → client:

- `run.event`, `run.finished { run }`
- `project.activity { activeRuns }`. The Vite plugin also subscribes, to hold reloads.
- `git.changed { summary }`, pushed after every run and after a file watcher sees changes, debounced 300ms. This replaces polling.
- `pty.data`, `pty.exit`, `test.output`, `test.finished { status, summary }`

Port the existing `git-service.ts`, `pty-service.ts`, and `test-service.ts` from `devtools-vite` into `@aidev/gateway/src/workspace/`. Keep their tests and move those too.

### 3.2 Run lifecycle (agent mode)

1. Validate, and confine `cwd` to the project root.
2. If the thread exists and the provider `supportsResume`, pass `providerSessionId` to the adapter. Otherwise prepend a compact transcript of the last 6 turns, capped at 8 KB, inside `<previous_conversation>`.
3. **Checkpoint** (agent mode only): record `HEAD`, the list of dirty paths, and a snapshot ref. Use `git stash create` (it does not touch the tree); if it prints nothing, use `HEAD`. Store the ref as `refs/aidev/checkpoints/<runId>` via `git update-ref`. Emit `checkpoint`.
4. If the tree has conflicts, emit an `error` and do not start. If it is dirty, emit a warning `chunk` with `segment: -1` (the UI renders it as a notice, not as assistant text).
5. Spawn, stream, and persist each event to JSONL before broadcasting.
6. On exit, compute `filesTouched` as paths changed relative to the checkpoint that were not in `dirtyBefore`, plus any `file_edit` paths. Emit `files_changed`, then `done`. Broadcast `git.changed`.
7. **Restore** (`git.checkpoint.restore`): for each file in `filesTouched`, check out that file from the checkpoint ref. Delete files the run created. Never touch paths outside `filesTouched`.

Concurrency: at most one agent run per project (queue the next one and show it as `queued`). `maxConcurrentRuns` (default 4) applies across all projects and inference. Over the limit, return `429` with a `Retry-After` header.

### 3.3 Adapter correctness and capability discovery

**Rule for implementers: never add a CLI flag that you have not seen in that CLI's `--help` on this machine.** Record each verified flag set in `packages/adapters/CONTRACTS.md` with the CLI version and date.

- **Claude.** Remove `--permission-prompts` and `--bare`. Agent mode: `-p <prompt> --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools <list>`. Ask/plan mode: `--permission-mode plan`, tools limited to `Read,Glob,Grep`. Add `--model`, `--append-system-prompt`, `--resume <id>`, `--json-schema`, and `--no-session-persistence` for ephemeral runs. Before relying on any of these, confirm each one against `claude --help`. In particular, check whether `stream-json` needs `--verbose`.
- **Cursor.** Keep the current argv. Add `--model`, `--resume <chatId>`, and `--mode ask|plan` for read-only modes; drop `--force` in those modes. Capture the chat id from the `system`/init event as `providerSessionId`. Find out how `agent` deletes a chat (check `agent --help` and its subcommands). If it cannot, ephemeral runs use an isolated scratch workspace so they do not pollute the project's history, and the docs say so. Remove the dead `.cursor/worktrees/<gatewayId>` cleanup.
- **Codex** and **Antigravity**. Keep them. Mark `verified: false` until someone runs the contract test on a machine with the binary. The UI shows them as "experimental". Fix the Codex `--jsonl` versus `--json` question against the real `codex exec --help` before marking it verified.
- Add `capabilities()` to each adapter, and `version()` (`<bin> --version`, cached). Cursor models come from `agent --list-models`, cached for 10 minutes. Claude models are its documented aliases (`sonnet`, `opus`, `haiku`) plus whatever `--model` accepts.
- **Live contract tests** in `packages/adapters/test/live/*.live.test.ts`, run only when `AIDEV_LIVE=1`:
  - `--help` contains every flag the adapter emits.
  - An ask-mode "Reply with exactly: OK" returns a `chunk` containing `OK`, a `session_info`, and one `done`.
  - A resume run recalls a word from the previous turn.
  - Agent mode in a temp git repo edits one file.
- `aidev doctor` runs those checks (minus the edit) and prints a table. The dashboard shows the same result.

### 3.4 Sessions you can keep or throw away

- `GET /api/v1/threads?projectId=&source=&limit=` and `GET /api/v1/threads/:id` (with runs). `GET /api/v1/threads/:id/events?runId=` streams JSONL as SSE, live if the run is active.
- `DELETE /api/v1/threads/:id`: cancels any active run, deletes local files, and asks the provider to forget the chat when that is supported (Claude: nothing to delete if the run used `--no-session-persistence`; Cursor: see 3.3).
- Keep the old `POST /api/v1/sessions` and `POST /api/v1/prompt` working as thin wrappers that create a one-run thread. `ephemeral: true` maps to `keep: false` plus provider-side forgetting. Update the manual, which wrongly says `GET /sessions/:id` returns events.

### 3.5 Inference API (the forgotten half)

Goal: from any project, `fetch('http://127.0.0.1:4100/v1/chat/completions')` or use the OpenAI SDK with `baseURL`, and get an answer from a CLI you are already signed into. No key setup, no edits anywhere.

- `POST /api/v1/infer`:

  ```
  { provider?, model?, system?, messages: [{ role, content }], jsonSchema?, images?: [{ dataUrl } | { path }], stream?, timeoutMs?, keep? }
  ```

  It always runs in `ask` mode, in a fresh `~/.aidev/scratch/<runId>` directory (empty, not a git repo), with no project. The reply is the concatenated `chunk` text. With `jsonSchema`:
  - Claude uses `--json-schema` (if verified).
  - Other providers get the schema appended to the system instructions with "reply with JSON only". The gateway extracts the first JSON object or array, validates it with Ajv, and retries once with the validation errors. If it still fails, it returns `422 invalid_structured_output` with the raw text.
- `POST /v1/chat/completions`: an OpenAI-compatible façade over `/api/v1/infer`.
  - `model` is `"<provider>/<model>"` (for example `cursor/gpt-5`, `claude/sonnet`) or just `"<provider>"`.
  - Supports `stream: true` (SSE `chat.completion.chunk` frames, then `[DONE]`), `response_format: { type: 'json_schema', json_schema }`, and image content parts (data URLs written to `attachments/`).
  - Tool calling is out of scope: return `400` if `tools` is sent.
  - `GET /v1/models` lists `provider/model` ids from the capability matrix.
- **Images.** Write them to `attachments/<runId>/n.png`. Providers with `supportsImages` get the native flag, if one exists and is verified. Others get the file paths in the prompt: "Attached images: <paths>. Open and look at them before answering." Ask mode still allows reading. Verify per provider that the model actually describes the image (live test).
- **`@aidev/client`**:

  ```ts
  const ai = createClient();   // reads ~/.aidev/token, or AIDEV_TOKEN and AIDEV_URL
  await ai.generate({ prompt, model: 'claude/sonnet' });
  for await (const t of ai.stream({ prompt })) process.stdout.write(t);
  const obj = await ai.generateObject({ prompt, schema });   // Zod or JSON Schema
  ```

  Include a README snippet that uses the official `openai` package with `baseURL` instead.
- Latency is CLI cold start (seconds). Document it honestly. `examples/inference-node` and `examples/inference-next-route` show the typical uses: a script, and a Next.js route handler proxying to the gateway in dev.

### 3.6 Startup and DX

- `aidev` binary:
  - `aidev start [--port] [--detach]` and `aidev stop`.
  - `aidev status`: running? version? projects and active runs.
  - `aidev doctor`.
  - `aidev projects add <path>`.
  - `aidev init`: run in a frontend repo. It detects Vite or Next and the package manager, installs `@aidev/vite` (or prints the Next snippet), edits `vite.config.*` with a minimal AST-free insertion and shows the diff, then registers the project.
  - `aidev open`: opens the dashboard.
- The Vite plugin auto-start: if `/health` fails, spawn `aidev start --detach`, resolved from the plugin's own dependency on `@aidev/gateway`, and wait up to 5s. With `autoStart: false`, print one clear line instead.
- `/health` adds `version`. Authenticated `GET /api/v1/status` returns active runs, the project list, and the provider summary.

### 3.7 Dashboard (small, served by the gateway)

A static Preact app at `/` (same design tokens as the overlay). It authenticates with the machine token, delivered by a one-time code: `aidev open` opens `/?code=…` and the gateway swaps the code for an httpOnly cookie. Pages:

- **Providers**: the capability matrix, doctor results, and setup steps for missing or signed-out CLIs.
- **Threads**: filterable by project and source. A transcript viewer reuses the overlay's transcript renderer, extracted to a shared module; it shows raw events, keep/delete, and resume in a new run.
- **Projects**: add or remove roots, last seen.
- **Playground**: a prompt box over `/api/v1/infer` with provider/model/schema pickers and a copyable `curl` and `@aidev/client` snippet. This is the "quick prototyping" entry point.

---

## 4. Overlay redesign in detail

### 4.1 Design system

Create `packages/overlay/src/ui/theme/tokens.ts`, which emits CSS custom properties on `:host`, and split `styles.ts` into per-component style modules concatenated at build time. Remove raw hex and px values from component styles.

```
--aid-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
--aid-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace
--aid-text-xs 12px  --aid-text-sm 13px  --aid-text-md 14px (base)  --aid-text-lg 16px  --aid-text-xl 18px
--aid-line 1.5
--aid-space-1..6 4 8 12 16 24 32px
--aid-radius-sm 6px  --aid-radius-md 10px  --aid-radius-lg 14px
dark (default): --aid-bg #0f1115  --aid-bg-raised #161921  --aid-bg-hover #1d212b  --aid-border #262b36
                --aid-text #e7e9ee  --aid-text-muted #9aa3b2  --aid-accent #7c6cff  --aid-accent-fg #fff
                --aid-success #3ecf8e  --aid-warning #f5a524  --aid-danger #f05d5e
                --aid-add-bg rgba(62,207,142,.14)  --aid-del-bg rgba(240,93,94,.14)
light: same names, overridden under :host([data-theme=light]); `system` follows prefers-color-scheme
--aid-shadow-lg 0 12px 40px rgba(0,0,0,.35)
--aid-ease cubic-bezier(.2,.8,.2,1)  --aid-dur 160ms (0ms under prefers-reduced-motion)
--aid-z 2147483600 (host)  layers inside the host: highlight 10, dock 20, popover 30, toast 40, modal 50
```

Rules:

- `font-family: var(--aid-font)` is applied to `:host *` explicitly, because `all: initial` resets it to serif. A test asserts the computed font of every text-bearing element type.
- 14px base. Nothing smaller than 12px.
- Icons: inline SVG from a tiny local set (copy roughly 25 Lucide icons as Preact components, no runtime dependency). Every icon-only button has `aria-label` and a tooltip.

### 4.2 Layout and information architecture

Replace floating cards with **docks**:

- **Launcher pill** (collapsed state). It sits bottom-right by default, can be dragged to any corner (snaps; the position is persisted), and is 40px tall. It holds the logo, the status dot (green connected, amber run active with a spinner, grey offline, red provider error), Inspect, and an expand chevron. Badges sit on the pill: unread reply, error count, changed files. Below 640px it shows icons only.
- **Side dock** (Chat, Review). It is pinned right, full height, 420px by default, resizable 340–720px with a drag handle (width persisted), and can switch to the left side. While docked it pushes the page, via `html { margin-right: <w>px }`. The push is configurable (default "push"; "overlay" mode for apps that break when pushed). Review widens itself to `max(640px, 50vw)` when opened from a run.
- **Bottom dock** (Terminal, Tests, Console). Full width, 280px by default, resizable, Chrome-DevTools style. It can be open at the same time as the side dock.
- **Tabs** live in the dock headers, not in the pill: side dock shows Chat · Review · History; bottom dock shows Terminal · Tests · Console.
- **Under 768px** both docks become bottom sheets (snap points 40% / 90%) and the pill stays fixed.
- **Command palette** (`⌘K` / `Ctrl+K` while the page has focus, configurable) lists: Inspect, New chat, Review changes, Undo last run, Run tests, Open terminal, Switch provider/model/mode, Toggle theme, Settings, Hide toolbar (until reload).
- **Keyboard**: `⌘⇧C` toggles inspect (the same as Chrome; configurable to avoid clashes). `Esc` closes the topmost layer (popover → modal → inspect → dock). `⌘Enter` sends, and the hint reads `Ctrl Enter` on non-Mac. `⌘.` stops a run.
- **Persistence** (`sessionStorage`, keyed by projectId):
  - open docks and tabs, dock sizes, pill position, current threadId, draft text
  - selected element descriptors (re-resolved by `data-loc` after reload)
  - theme, provider, model, and mode in `localStorage`

  The transcript itself is reloaded from the gateway (`thread.get`), so a full reload loses nothing.

### 4.3 Chat

Replace `ChatLine` with a structured transcript model in `src/ui/chat/model.ts`:

```ts
type TurnItem =
  | { kind: 'user'; id; text; chips: ContextChip[] }
  | { kind: 'assistant'; id; runId; blocks: Block[]; status: Run['status']; durationMs? }
  | { kind: 'notice'; id; tone: 'info' | 'warning' | 'error'; text; actions?: Action[] };
type Block =
  | { kind: 'markdown'; text }                       // one per chunk segment
  | { kind: 'tool'; toolCallId; name; label; target?; args?; result?; state: 'running' | 'ok' | 'error' }
  | { kind: 'files'; files: { path; additions; deletions }[] }   // from files_changed
```

A pure reducer, `applyEvent(state, event)`, has unit tests for every event type and for interleaving.

Rendering:

- **Markdown subset**: paragraphs, emphasis, inline code, fenced code with copy, lists, links. Use a ~3 KB handwritten renderer or `snarkdown` wrapped with HTML escaping. Never use `innerHTML` with unescaped model text.
- **Tool calls**: compact rows with an icon and verb ("Edited `Hero.tsx`"), a spinner while running, ✓/✕ when done, collapsed by default. Expanding shows args and a truncated result. Consecutive reads collapse to "Read 4 files".
- **Run footer**: status, duration, model, and the files block ("2 files changed +12 −3"), with **Review**, **Undo**, and **Keep going** buttons. Undo calls `git.checkpoint.restore`.
- **Errors**: rendered as an error notice with the `setup` steps as a checklist and a **Retry** button. `provider_unavailable` and `cli_auth_required` get a "Copy command" action.
- **Dirty-tree warning**: a notice before the run ("3 files already modified. Undo will only revert what the agent changes.").
- **Auto-scroll** only while the user is at the bottom. Otherwise show a "Jump to latest" pill. `aria-live` goes on a single status line ("Agent is editing Hero.tsx…"), not the transcript.

Composer:

- **Context chips** above the textarea, each removable, with hover previews:
  - selected element(s) (`Hero · Hero.tsx:11`)
  - screenshot thumbnail (click to enlarge or annotate)
  - "3 console errors"
  - "1 failed request"
  - "Vite error"
  - "Test failure"

  Errors are auto-attached only if they occurred in the last 2 minutes. Each kind can be toggled in Settings.
- **`@` mentions**: `@file` (fuzzy search over `git ls-files` through the workspace socket) and `@selection`.
- **Pickers** under the textarea:
  - provider (disabled options with an "not installed" or "experimental" tag; tooltip with setup)
  - model (from capabilities)
  - mode: **Agent** (edits) / **Ask** (read-only, for questions like "where is this styled?")

  Send is disabled with a reason tooltip when the provider is unavailable.
- **Suggestions** appear only for an empty thread and are derived from the selection: "Make `Hero` responsive", "Add a hover state to this button", "Fix the 2 console errors". Clicking inserts into an empty composer, or appends on a new line.
- **New chat** button. **History** tab lists this project's threads (title, provider, time, run count) and resumes any of them.

Multi-turn: the composer sends `threadId`. The gateway resumes the provider session (section 3.2), so "now make it bigger" works.

Notifications: when a run finishes while the side dock is closed, show a toast ("Edited 2 files · Review / Undo") and an unread badge. Optional `document.title` prefix `✓ ` until the user focuses the page.

### 4.4 Inspector

- **Hover label**: `ComponentName · File.tsx:11` on the first line, `button 130×44` muted on the second. Resolve it on hover, throttled with rAF and cached per element. It flips above or below and left or right to avoid the viewport edge and the target box, with 6px gap. Show the margin and padding boxes as tinted bands (like Chrome) when Alt is held.
- **Pick target**: default to the deepest element with a `data-loc` stamped by user code (skip `node_modules`). Click picks the hovered element itself, not the component root. The chip shows the nearest component name.
- **Parent walk**: `↑`/`↓` while hovering moves through DOM ancestors and descendants that have a `data-loc`. After a pick, the chip has a breadcrumb popover (`CardGrid › ProductCard › strong`) where any ancestor can be chosen.
- **Multi-select**: Shift+click adds up to 5 elements. Each becomes a chip and is numbered on the page with small badges while the chat is open.
- **Open in editor**: an action on the chip and the hover label (`⌥click`). It goes through the gateway endpoint `POST /api/v1/projects/:id/open { file, line, column }`, which runs `cursor -g`, `code -g`, or `$EDITOR`, chosen in Settings (default: the provider's IDE if present). Do not use `vscode://` links, which do not work for every editor.
- **Screenshot tools**:
  - **Element** (default with selection).
  - **Region**: drag a rectangle, rendered with `html-to-image` on the document root and cropped.
  - **Viewport**.

  After capture, an annotation layer offers pen, arrow, rectangle, and text in the accent color, with undo, then "Attach". Images are downscaled to at most 1600px on the long edge, then sent as attachments (bytes go to the gateway, written to `attachments/`, path passed to the CLI per 3.5). Show a warning chip when capture fails (tainted canvas) instead of failing silently.
- `html-to-image` and the annotation code are lazily imported (see 4.7).

### 4.5 Errors as first-class context

- A new `context/vite.ts` hooks `import.meta.hot` events `vite:error` and `vite:beforeUpdate`. Through the injected config it receives HMR compile errors. A capture-phase `error` listener on `window` catches resource load errors.
- Patch `XMLHttpRequest` as well as `fetch`. Record method, URL (query values for keys matching `token|key|secret|password|auth|session` redacted), status, duration, and the first 500 characters of the response body for 4xx/5xx JSON.
- Install capture **as early as possible**: the plugin injects a tiny inline `<script>` before everything else that buffers errors until the overlay loads.
- The pill error badge counts errors since the last run. Clicking it opens the **Console** tab in the bottom dock: a filterable list with stack traces mapped to source files via the error's file:line. Each entry has **Fix with AI**, which opens Chat with the error chip attached and the prompt "Fix this error" prefilled.
- If Vite's own error overlay (`vite-error-overlay`) is present, inject a "Fix with AI" button into it (it is an open shadow root).
- Redaction pass before any context leaves the page:
  - drop `value` attributes of inputs of type password, email, tel, or with `autocomplete` containing `cc-`
  - strip the same query keys as above
  - cap total context JSON at 32 KB, trimming oldest logs first

### 4.6 Review (the old Diffs)

- **Scope selector** at the top: "This run" (default when opened from a run: `filesTouched`), "This thread", or "All changes" (working tree vs HEAD).
- **File list**: status icon, path (directory muted), `+a −d`, and a checkbox for inclusion. Use keyboard navigation (`j`/`k`). Per-file overflow menu: Open in editor, Discard file, Copy path.
- **Diff**:
  - unified or split toggle (persisted)
  - syntax highlighting via a tiny tokenizer for TS/JS/JSX/CSS/HTML/JSON, lazily loaded. Shiki is too big unless loaded on demand from the gateway, which can serve it.
  - line-number gutters of fixed width (`4ch` each) with a gap
  - `white-space: pre` with horizontal scroll inside the hunk container (`min-width: 0` on flex parents)
  - collapsed unchanged regions with "Show 20 more lines"
  - per-hunk Discard (applies a reverse patch via `git apply -R` on that hunk, through the gateway)
- **Commit box**:
  - shown only when files are selected
  - message field with **✨ Generate**, which calls `commit.suggest`: an inference run in ask mode with the staged diff (truncated to 20 KB) and the thread's prompts. It returns a conventional-commit-style message the user can edit.
  - branch indicator with "New branch…" (prefilled `aidev/<slug-of-thread-title>`)
  - Commit, then Commit & Push (a split button)
  - after push, if `gh` is available and authenticated, offer **Open PR** (`gh pr create --fill` or title/body from the generator via argv, never a shell string) and show the PR URL
- **Log** sub-tab: the last 20 commits with "undo commit" (`git reset --soft HEAD~1`) only for unpushed commits created through the overlay.
- **Discard** opens a small modal that lists the exact files, with a "Discarding…" state. Untracked files are deleted only if listed and checked.
- **Empty state**: centered icon, "No changes yet", and a hint. The commit chrome is hidden.

### 4.7 Terminal, Tests, Console (bottom dock)

- **Terminal**:
  - The session survives tab switches and dock close. It is disposed only by an explicit "Kill" or after 30 minutes idle with the dock closed.
  - Multiple terminals as sub-tabs.
  - Header with cwd, a Clear button, and a "fallback shell" warning when `node-pty` is not loaded.
  - The xterm theme comes from tokens.
- **Tests**:
  - Detect Vitest or Jest. Run with a JSON reporter to a temp file (`vitest run --reporter=json --outputFile=…`, `jest --json --outputFile=…`) alongside streamed text output.
  - Force one-shot mode (append `run` for `vitest` scripts that would watch, and set `CI=1`).
  - Show a summary bar (passed/failed/skipped, duration) and a tree of files → tests. Failures expand to the message, the diff of expected/received, and a stack linked to Open in editor.
  - Stop button. "Re-run failed". "Run this file".
  - **Fix with AI** on a failure attaches the test name, error, and file chip to a new chat.
  - Option "Run tests after each agent run" (off by default); the result is appended to the run footer.
- **Console**: the list from 4.5.
- Bundle: xterm, the tokenizer, `html-to-image`, and the annotation layer are separate chunks loaded on first use. Build the overlay as ESM chunks served by the plugin/gateway, with a small IIFE loader that imports the entry. Track bundle size in CI: the initial loader stays under 60 KB gzip.

### 4.8 Settings

A modal reachable from the palette and the pill menu:

- **General**: theme; dock behavior (push/overlay); keyboard shortcuts; editor for "Open in editor".
- **Agent**: default provider, model, and mode; auto-attach toggles per context kind; run tests after agent runs; keep threads (on/off → `keep`).
- **Connection**: gateway URL (read-only, from config), status, version, "Open dashboard".

### 4.9 Accessibility checklist (part of every UI acceptance)

- Every interactive control is reachable by Tab inside the shadow root, with a visible `:focus-visible` ring.
- Opening a dock focuses its primary control. Closing returns focus to the pill button that opened it.
- Modals trap focus and close on Esc.
- Icon buttons have names.
- Contrast is ≥ 4.5:1 for text in both themes.
- No information is conveyed by color alone (diff rows also have `+`/`−`).

---

## 5. Phases

Each phase ends with the following, plus the phase's own checks:

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm e2e
```

Do not start a phase until the previous one is merged, except where noted as parallelizable. Keep commits small: one concern per commit, conventional messages.

### Phase 0 — Baseline (half a day)

1. The working tree has ~960 lines of uncommitted overlay and Cursor-auth work from the previous session. Run the checks and commit it as is (`feat(overlay): polish chrome; feat(cursor): reuse IDE login`) before anything else.
2. Fix the Claude adapter flags (3.3, Claude bullet) and update `mock-claude.js` to reject unknown flags the way the real CLI does.
3. Quick visible fixes that survive the redesign anyway:
   - diff line-number gutters and horizontal scroll
   - `MODIFIED · path` header
   - disable sending to unavailable providers
   - Tests kicker shows the package name, not "Demo suite"
   - Tests Stop button
   - Terminal stays mounted across tab switches
4. Correct `docs/manual.md` where it describes behavior that does not happen (socket prompt path, in-process fallback, dirty-tree warning, `GET /sessions/:id` events). It must describe reality at every commit.

Acceptance:

- `claude` prompts work from the overlay on a machine signed into Claude Code without `ANTHROPIC_API_KEY`.
- The diff of a 200-character line scrolls horizontally.
- Line numbers read `9  9`, not `99`.

### Phase 1 — Companion architecture, packaging, and security (largest; do first)

1. Rename packages to `@aidev/*` (2.2), with no behavior change. Remove `private` from the publishable packages, keep `workspace:*` (pnpm rewrites it on publish), and add `exports` for `./overlay.js`.
2. Add `@aidev/protocol` with every schema from 2.4 and 3.1, plus tests.
3. Gateway: token and config bootstrapping (2.3, 2.5), project registry, CORS allowlist, `Origin` checks, and bearer auth middleware. Support multiple project roots (replaces single `GATEWAY_ROOT`; keep the env var as "auto-register this root").
4. Move the git, PTY, and test services into `@aidev/gateway/src/workspace/`, with realpath confinement for git paths, no inlining of symlink targets, and discard limited to explicitly listed paths. Implement the workspace WebSocket (3.1).
5. Overlay: one `WorkspaceClient` (WebSocket with reconnect, exponential backoff capped at 5s, request/response by `requestId`) replaces `GatewayClient` and `ViteHmrBridge`. Chat, Diffs, Terminal, and Tests all use it.
6. Vite plugin: register the project, inject `{ gatewayUrl, projectId, browserToken }` and the early-error buffer script, keep `data-loc`, and hold full reloads while `project.activity.activeRuns > 0` (subscribe through the gateway WS from Node). Add auto-start. Delete `bridge.ts`'s in-process runner and the socket services.
7. `aidev` binary with `start`, `stop`, `status`, `doctor`, `projects add`, and `open` (dashboard can be a placeholder page for now).
8. Update the e2e loop to the new path. Add security tests:
   - a request with `Origin: https://evil.example` gets no CORS header, and its WebSocket is closed with 4403
   - requests without a token get 401
   - one project's browser token cannot touch another project's root
   - PTY refuses when the token is missing

Acceptance:

- With only `pnpm demo` running (no manual gateway start), the toolbar appears, and a Cursor edit, diff, and commit work.
- `curl -H 'Origin: https://evil.example' -X POST 127.0.0.1:4100/api/v1/sessions …` is rejected.
- Two different repos registered at once both work; a path outside both returns `path_escape`.
- `pnpm ls --depth 1 --filter @aidev/vite` shows no `node-pty`.

### Phase 2 — Threads, checkpoints, persistence (gateway) — parallel with Phase 4 once Phase 1 is merged

1. `ThreadStore` with JSON/JSONL files, and retention (2.5).
2. Run lifecycle with checkpoint, `filesTouched`, and restore (3.2). Run queueing and the 429 limit.
3. Provider session ids, resume, and the transcript fallback (3.2 step 2, 3.3). Single `done`, `segment`, `toolCallId`.
4. Thread routes (3.4), plus legacy route wrappers.
5. Live contract tests and `aidev doctor` output (3.3).

Acceptance:

- Two overlay prompts in one thread: the second ("now make it red too") changes the same element without restating it, on Cursor and Claude.
- Restart the gateway: the thread and all events are still listed.
- Undo after a run on an already-dirty tree restores only the agent's edits; the pre-existing edits survive (e2e test with a scripted provider).
- `AIDEV_LIVE=1 pnpm --filter @aidev/adapters test:live` passes for each installed provider.

### Phase 3 — Inference API and client — parallel with Phases 4–5

1. Ask/plan mode per adapter (3.3). Scratch directories.
2. `/api/v1/infer`, `/v1/chat/completions` (streaming and non-streaming), and `/v1/models`. Structured output with validation and retry. Image attachments.
3. `@aidev/client` with `generate`, `stream`, and `generateObject`, and tests against a scripted provider.
4. `examples/inference-node` and `examples/inference-next-route`. Rewrite `examples/gateway-client` on top of the client.
5. Manual: a new top-level section, "Use it as an LLM API".

Acceptance:

- The official `openai` npm package with `baseURL: 'http://127.0.0.1:4100/v1'` and `apiKey: <machine token>` streams a completion from `cursor` and from `claude`.
- A `generateObject` call with `{ name: string, tags: string[] }` returns a validated object.
- After inference runs, `git status` of this repo is unchanged and `~/.aidev/scratch` is empty.
- An image-description request mentions the image's dominant color (live test, per provider with images verified).

### Phase 4 — Overlay shell redesign — can start once Phase 1 merges

1. Tokens and themes (4.1). Split `styles.ts`. Icon set.
2. Launcher pill, side dock, bottom dock, resizing, push mode, and mobile sheets (4.2).
3. Command palette, keyboard map, Settings modal (4.8), and persistence (4.2).
4. Toasts and badges infrastructure.
5. Accessibility pass (4.9).
6. Visual regression: a Playwright spec, `apps/demo-react-app/e2e/visual.ts`, that screenshots pill, chat, review, terminal, and tests at 1440×900 and 390×844 in both themes. Compare with `toHaveScreenshot`-style pixel diff (maxDiffPixelRatio 0.01). Commit the baselines.

Acceptance:

- No overlay element ever covers the page at 1440px with the side dock open in push mode.
- At 390px the pill fits, and docks open as sheets.
- Every text element computes to the sans stack at ≥ 12px.
- The keyboard-only flow works: open palette, inspect, pick, type, send, review, commit.
- The Playwright visual suite passes.

### Phase 5 — Chat and context — after Phase 2 contracts exist (they can be mocked)

1. Transcript model and reducer, the markdown renderer, tool rows, run footer, notices (4.3).
2. Composer with chips, `@` mentions, provider/model/mode pickers, contextual suggestions, and New chat/History.
3. Error capture upgrades, the Console tab, Fix with AI, Vite overlay button, and redaction (4.5).
4. Screenshot attachments reach the CLI end to end (with 3.5 image handling).

Acceptance:

- A streamed reply with inline code and a list renders formatted, with a paragraph break between pre-tool and post-tool text.
- Each tool row ends in ✓ or ✕.
- Reload mid-run: the transcript and the live stream resume.
- Clicking the demo's "Throw" button shows an error badge. "Fix with AI" produces a prompt whose `<frontend_context>` contains that stack.
- A selected element's screenshot file exists under `~/.aidev/attachments/<runId>/` and its path is in the CLI argv or prompt (scripted-provider e2e asserts it).
- Password input values never appear in the composed prompt (unit test).

### Phase 6 — Inspector — parallel with Phase 5

All of 4.4.

Acceptance:

- Hovering the $86 price shows `ProductCard · CardGrid.tsx:<line>` (or the real component name), and the click attaches the `strong` with `ProductCard` as the chip's component.
- `↑` walks to the card.
- Shift+click attaches two chips.
- "Open in editor" opens Cursor at the right line (manual check, documented).
- A region screenshot with an arrow annotation attaches as one image.

### Phase 7 — Review and ship

All of 4.6.

Acceptance:

- After a run, Review opens on "This run" with only the run's files.
- Per-hunk discard works on a two-hunk file.
- Generate produces a sensible message from a scripted inference provider in e2e; manually verified with a real provider.
- Commit & Push on a branch, then Open PR, prints a PR URL in a repo with `gh` set up (manual, documented).
- Syntax highlighting is visible in TSX.
- Split view works.

### Phase 8 — Terminal and tests

All of 4.7.

Acceptance:

- A failing Vitest test shows as a red row with the expected/received diff.
- "Fix with AI" opens a chat with the failure attached.
- Stop kills a running suite within 2 seconds.
- A `"test": "vitest"` script does not hang.
- The terminal survives switching to Chat and back with scrollback intact.

### Phase 9 — Dashboard — parallel with 5–8 after Phase 2

All of 3.7. It shares the transcript renderer with the overlay (move it to `@aidev/overlay/src/ui/chat/` and export it for the dashboard build).

Acceptance:

- `aidev open` shows providers with doctor results, and threads from both overlay and API sources with readable transcripts.
- The Playground returns a structured-output result and a copyable `curl`.

### Phase 10 — Reach beyond Vite + React

1. Script-tag install documented: any dev server, with `aidev projects add .` producing a snippet that includes a token. Component names come from React Fiber when available; otherwise the DOM path is shown and `data-loc` is absent.
2. `@aidev/next`: injects the script in development via a `<AidevScript />` component for the app router layout, and a webpack/Turbopack loader for `data-loc` (SWC plugin if a loader is not viable — investigate and document).
3. Vue (`@vue/compiler-sfc` node transform) and Svelte (preprocessor) `data-loc` stampers as options of `@aidev/vite`, each with one fixture test.
4. `aidev init` handles Vite and Next.

Acceptance:

- A fresh `create-vite` React app, a fresh Next app, and a fresh Vue Vite app each reach "inspect → edit → review" following only the README, with no manual env vars.

### Phase 11 — Docs and polish

1. Rewrite README around the two products: "Edit your app from the browser" and "Use your CLI subscription as a local LLM API". Each gets a 60-second quickstart.
2. Restructure `docs/manual.md` into `docs/overlay.md`, `docs/gateway-api.md`, `docs/providers.md` (capability matrix, verified versions, setup), and `docs/security.md`.
3. Regenerate all screenshots from the Playwright visual suite, so the docs always match the product. Add a short GIF of the full loop.
4. Name the product: ask the owner, then rename the scope and constants.

---

## 6. Guardrails for implementing agents

- **Never invent CLI flags.** Check `<bin> --help` and record the flag in `CONTRACTS.md`. If a provider binary is not installed, keep that adapter `verified: false` and say so in your summary.
- **Never weaken a security check to make a test pass.** If a test needs access, register a project and use its token.
- **Keep the scripted provider** (`apps/demo-react-app/e2e/scripted-gateway.ts`) in step with every protocol change. All e2e tests use it; live CLIs are only for `*.live.test.ts`.
- **Do not commit or push in this repository from e2e tests.** Stage the demo in a temp repo, as `loop.ts` does.
- **Docs follow code.** If a commit changes behavior described in docs, update the docs in the same commit.
- **Bundle budget**: the overlay's initial load stays under 60 KB gzip. Check it in `pnpm test` with a size assertion.
- **No `innerHTML` with model or page text** except through the escaping markdown renderer, which has XSS tests (`<img onerror>`, `javascript:` links).
- When a requirement here turns out to be wrong for a real CLI (for example a provider cannot resume), implement the closest honest behavior, surface it in the capability matrix, and note it in the phase summary rather than faking it.

---

## 7. Verification matrix

| Area | Automated | Manual (record result in the PR description) |
| --- | --- | --- |
| Protocol | Zod round-trip tests for every message | — |
| Adapters | Unit (argv, parsing), live contract (`AIDEV_LIVE=1`) | `aidev doctor` on a machine with each CLI |
| Security | CORS/Origin/token/cross-project tests, PTY refusal, redaction, markdown XSS | Try driving the gateway from a page on another origin |
| Threads | Persistence across restart, resume, retention | Resume a Cursor and a Claude thread from the overlay |
| Checkpoints | Undo on dirty tree (e2e) | Undo after a real multi-file run |
| Inference | OpenAI SDK compatibility, schema validation/retry, scratch cleanup | Use it from a separate Next.js project |
| Overlay UI | Reducer tests, component tests, Playwright visual at 2 sizes × 2 themes, keyboard flow | Use it for 30 minutes on a real app and file papercuts |
| Workflow | e2e: inspect → prompt → HMR → follow-up → review this run → generate message → commit → undo | Push and open a PR via `gh` |
| Install | `aidev init` in temp `create-vite` and `create-next-app` projects (CI job, no CLI needed) | Fresh machine, README only |

---

## 8. Open decisions for the owner

These do not block Phases 0–3. Ask before the phase that needs them.

1. **Product name and npm scope** (placeholder `@aidev`). Needed before publishing (Phase 11), cheaper if decided before Phase 1.
2. **Default dock behavior**: push the page (recommended) or overlay it.
3. **Retention default**: 7 days, keep everything, or ephemeral by default for API/inference threads (recommended: overlay threads kept 30 days, inference threads 1 day unless `keep: true`).
4. **Publishing target**: public npm, or private/GitHub Packages for now.
