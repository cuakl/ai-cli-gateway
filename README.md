# AI CLI Gateway

A pnpm monorepo for two related tools:

- An **AI CLI gateway** that runs already-authenticated local agent CLIs (`agent`, `agy`, `claude`, `codex`) behind one process API and, later, one HTTP/WebSocket server.
- A **frontend DevTools overlay** that will inspect a running page, collect context, and send edit prompts through that gateway.

The full build order is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Status

Phase 1 is implemented: the workspace, shared contracts, the adapter base class, CLI binary resolution, and the process supervisor.

| Phase | Package | State |
| --- | --- | --- |
| 1 | `@gateway/shared-types`, `@gateway/core` | Implemented |
| 2 | CLI adapters in `@gateway/core` | Not started |
| 3 | `@gateway/server` | Package placeholder |
| 4 | `@devtools/overlay` | Package placeholder |
| 5 | `@ai-devtools/vite-plugin` | Package placeholder |
| 6–7 | Git, terminal, demo app | `demo-react-app` is a placeholder |

## Requirements

- Node.js 20 or newer
- pnpm 10 (`packageManager` is `pnpm@10.7.1`)

## Scripts

From the repository root:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

`pnpm test` runs every package that defines a test script. Right now that is `@gateway/core`:

```bash
pnpm --filter @gateway/core test
```

## Layout

```
ai-cli-gateway/
├── packages/
│   ├── shared-types/        # @gateway/shared-types
│   ├── gateway-core/        # @gateway/core
│   ├── gateway-server/      # @gateway/server
│   ├── devtools-overlay/    # @devtools/overlay
│   └── devtools-vite/       # @ai-devtools/vite-plugin
└── apps/
    └── demo-react-app/
```

## `@gateway/shared-types`

Zod schemas and the TypeScript types inferred from them. The contracts cover:

- `ProviderType` and `PromptOptions`
- `UnifiedStreamEvent` (`init`, `chunk`, `tool_call`, `tool_result`, `file_edit`, `error`, `done`)
- `FrontendContextPayload`
- `GitDiffSummary` and `GitCommitRequest`
- Session records and client/server messages

## `@gateway/core`

Provider adapters will extend `BaseAdapter`. The base class resolves the CLI binary, validates `PromptOptions`, emits an `init` event, and delegates the child process to `ProcessManager`.

`BinaryResolver` looks up each provider with `which`, then checks common macOS install paths such as `~/.cursor/bin/agent`, `/usr/local/bin/agent`, and `/opt/homebrew/bin/*`. Cursor is resolved as `agent` (then `cursor-agent` and `cursor`). Antigravity is `agy`, Claude Code is `claude`, and Codex is `codex`.

`ProcessManager` spawns one child per session id. Arguments are an argv array, never a shell string. Stdout is decoded and split into lines before the adapter parses it. A hung process is stopped with `SIGTERM`, then `SIGKILL` after a grace period (default 2 seconds). The default run timeout is 5 minutes.

Set `GATEWAY_LOG_LEVEL` to `debug`, `info`, `warn`, `error`, or `silent`. The default is `info`. Test runs are silent unless the variable is set.
