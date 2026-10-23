# CLI argv contracts

Verified on this machine on 2026-10-23. An adapter may only pass a flag that appears in that CLI's `--help`.

## Claude Code

- Binary: `claude` (`~/.local/bin/claude`)
- Version: `2.1.173 (Claude Code)` from `claude --version`

Agent mode:

```
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools <list>
```

Ask and plan mode use `--permission-mode plan` and `--allowedTools Read,Glob,Grep` instead of `acceptEdits` and the agent tool list.

| Flag | In `claude --help` | Notes |
| --- | --- | --- |
| `-p`, `--print` | yes | Print response and exit. The prompt is the next argument. |
| `--output-format stream-json` | yes | Realtime streaming. Only works with `--print`. Choices: `text`, `json`, `stream-json`. |
| `--verbose` | yes | Required with `-p` and `--output-format stream-json`. Without it the process exits immediately: `Error: When using --print, --output-format=stream-json requires --verbose`. |
| `--include-partial-messages` | yes | Partial message chunks. Only works with `--print` and `--output-format=stream-json`. |
| `--permission-mode acceptEdits` | yes | Agent mode. Choices include `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan`. |
| `--permission-mode plan` | yes | Ask and plan. Same choices list. |
| `--allowedTools <list>` | yes | Also `--allowed-tools`. Comma or space-separated tool names. |
| `--model <model>` | yes | "Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name." |
| `--append-system-prompt <prompt>` | yes | "Append a system prompt to the default system prompt." Passed for `systemPrompt`. |
| `--resume <session id>` | yes | `-r, --resume [value]`: "Resume a conversation by session ID, or open interactive picker with optional search term." Passed for `providerSessionId`. |
| `--no-session-persistence` | yes | "Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)." Passed when `ephemeral` is true. |
| `--json-schema <schema>` | yes | "JSON Schema for structured output." Passed when `jsonSchema` is set. The value is the schema as a JSON string. Verified in `claude --help` on 2026-10-23 (Claude Code 2.1.173). |

Not passed:

| Flag | In `claude --help` | Why it is not passed |
| --- | --- | --- |
| `--permission-prompts` | no | `claude` exits 1 with `error: unknown option '--permission-prompts'`. |
| `--bare` | yes | Minimal mode. Auth is only `ANTHROPIC_API_KEY` or an apiKeyHelper; OAuth and the keychain are not read. Omitted so a signed-in Claude Code login still works. |

Live check the same day, in an empty temp directory, using the argv above and the prompt `Reply with exactly: OK`: the CLI started and wrote stream-json. The account returned 401 (`OAuth access token has expired`) before any model tokens, so that run had no `stream_event` text deltas. Lines observed: `system` (`init`, `status`, `api_retry`), `assistant` (a message whose content is text), and `result` (`is_error: true`, `result`, `duration_ms`, `total_cost_usd`).

`session_info` is taken from the `system` / `init` line's `session_id`, matching the fixture `{ "type": "system", "subtype": "init", "session_id": "..." }`. `model` is included when that line has one. Login was expired, so this shape was not re-checked live.

## Cursor Agent

- Binary: `agent`
- Version: `2026.10.22-27dcf5f` from `agent --version`

Agent mode (`mode` omitted or `agent`):

```
agent -p --output-format stream-json --stream-partial-output --trust --workspace <cwd> --force -- "<prompt>"
```

Ask and plan omit `--force` and add `--mode ask` or `--mode plan`. `--model <model>` and `--resume <chatId>` are added when `model` and `providerSessionId` are set. `systemPrompt` is prepended to the prompt as `<system_instructions>…</system_instructions>`. This CLI's help has no system-prompt flag. `ephemeral` does not change argv.

| Flag | In `agent --help` | Notes |
| --- | --- | --- |
| `-p`, `--print` | yes | Print responses for non-interactive use. |
| `--output-format stream-json` | yes | Choices: `text`, `json`, `stream-json`. Only works with `--print`. |
| `--stream-partial-output` | yes | Text deltas. Only works with `--print` and stream-json. |
| `--trust` | yes | Trust the workspace without prompting. |
| `--workspace <path>` | yes | Workspace directory. |
| `--force` | yes | Also `-f`. Force-allow commands unless explicitly denied. Agent mode only, and only when `yolo` is not false. |
| `--mode ask` / `--mode plan` | yes | "Start in the given execution mode. plan: read-only/planning (analyze, propose plans, no edits). ask: Q&A style for explanations and questions (read-only). (choices: "plan", "ask")." There is no `agent` choice; agent mode is the default and does not pass `--mode`. |
| `--model <model>` | yes | "Model to use (e.g., gpt-5, sonnet-4-thinking)." |
| `--resume <chatId>` | yes | `--resume [chatId]`: "Select a session to resume." |
| `--` | not listed | End-of-options separator. The prompt is the positional `prompt` argument, including when it starts with `-`. |

### Chat id

A live run on 2026-10-23 in an empty temp directory:

```
agent -p --output-format stream-json --trust --workspace . -- "Reply with exactly: OK"
```

The first line was:

```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/private/var/folders/...","session_id":"216c29ee-ce14-4d8e-9c74-a9b017677397","model":"Auto","permissionMode":"default"}
```

The adapter emits one `session_info` from that `system` / `init` line: `providerSessionId` is `session_id`, and `model` is included when present (`Auto` in this run). Later lines repeat `session_id` and do not emit another `session_info`.

### Deleting a chat

`agent` has no flag or subcommand that deletes a chat. Top-level help commands are `persist`, `install-shell-integration`, `uninstall-shell-integration`, `login`, `logout`, `mcp`, `plugin`, `worker`, `status`, `models`, `team`, `bedrock`, `about`, `update`, `create-chat`, `generate-rule`, `agent`, `ls`, `resume`, and `help`. Help for the chat-related ones:

- `agent ls` — "Resume a chat session." Only `-h`.
- `agent resume` — "Resume the latest chat session." Only `-h`.
- `agent create-chat` — "Create a new empty chat and return its ID." Only `-h`.
- `agent help persist` — `list`, `attach <session>`, `stop <session>`. `stop` stops a tmux-backed process session. It does not delete chat history. `agent persist stop --help` prints `Persistence requires tmux` on this machine.

`ephemeral` therefore does not remove a Cursor chat. The old cleanup of `.cursor/worktrees/<gatewaySessionId>` and `.cursor/sessions/<gatewaySessionId>` is gone. `agent -p` does not create those directories. `--worktree` (not used) creates a git worktree at `~/.cursor/worktrees/<reponame>/<name>`, and help has no flag that deletes it.

An unknown flag exits 1 with `error: unknown option '--not-a-real-flag'`.

## Codex and Antigravity

These mappings were not checked against a `codex` or `agy` binary on this machine. They are unverified.

- Codex ask and plan pass `--sandbox read-only`. Agent mode stays `--sandbox workspace-write`.
- `providerSessionId` is `codex exec resume <id>` and Antigravity `--conversation <id>`.
- Codex and Antigravity do not receive `model`, `systemPrompt`, or `ephemeral`. No flag for those was verified, so none is emitted.
- Session capture is also unverified. The parsers read `thread_id` on Codex `thread.started` and `session_id` on an Antigravity `init` line, which is what the fixtures emit. That shape was not confirmed against a live CLI.
