# CLI argv contracts

Verified on this machine on 2026-10-23. An adapter may only pass a flag that appears in that CLI's `--help`.

## Claude Code

- Binary: `claude` (`~/.local/bin/claude`)
- Version: `2.1.173 (Claude Code)` from `claude --version`

Agent mode:

```
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools <list>
```

| Flag | In `claude --help` | Notes |
| --- | --- | --- |
| `-p`, `--print` | yes | Print response and exit. The prompt is the next argument. |
| `--output-format stream-json` | yes | Realtime streaming. Only works with `--print`. Choices: `text`, `json`, `stream-json`. |
| `--verbose` | yes | Required with `-p` and `--output-format stream-json`. Without it the process exits immediately: `Error: When using --print, --output-format=stream-json requires --verbose`. |
| `--include-partial-messages` | yes | Partial message chunks. Only works with `--print` and `--output-format=stream-json`. |
| `--permission-mode acceptEdits` | yes | Choices include `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan`. |
| `--allowedTools <list>` | yes | Also `--allowed-tools`. Comma or space-separated tool names. |

Not passed:

| Flag | In `claude --help` | Why it is not passed |
| --- | --- | --- |
| `--permission-prompts` | no | `claude` exits 1 with `error: unknown option '--permission-prompts'`. |
| `--bare` | yes | Minimal mode. Auth is only `ANTHROPIC_API_KEY` or an apiKeyHelper; OAuth and the keychain are not read. Omitted so a signed-in Claude Code login still works. |

Live check the same day, in an empty temp directory, using the argv above and the prompt `Reply with exactly: OK`: the CLI started and wrote stream-json. The account returned 401 (`OAuth access token has expired`) before any model tokens, so that run had no `stream_event` text deltas. Lines observed: `system` (`init`, `status`, `api_retry`), `assistant` (a message whose content is text), and `result` (`is_error: true`, `result`, `duration_ms`, `total_cost_usd`).

## Cursor Agent

- Binary: `agent`
- Version: `2026.10.22-27dcf5f` from `agent --version`

Argv the adapter emits (unchanged). `--force` is left off when `yolo` is false.

```
agent -p --output-format stream-json --stream-partial-output --trust --workspace <cwd> --force -- "<prompt>"
```

| Flag | In `agent --help` | Notes |
| --- | --- | --- |
| `-p`, `--print` | yes | Print responses for non-interactive use. |
| `--output-format stream-json` | yes | Choices: `text`, `json`, `stream-json`. Only works with `--print`. |
| `--stream-partial-output` | yes | Text deltas. Only works with `--print` and stream-json. |
| `--trust` | yes | Trust the workspace without prompting. |
| `--workspace <path>` | yes | Workspace directory. |
| `--force` | yes | Also `-f`. Force-allow commands unless explicitly denied. |
| `--` | not listed | End-of-options separator. The prompt is the positional `prompt` argument, including when it starts with `-`. |

Codex and Antigravity were not checked against binaries for this file.
