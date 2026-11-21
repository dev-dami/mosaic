# Local agents: Mosaic Link

Mosaic Link lets a visitor run Mosaic's agent turns on Claude Code or Codex installed on
their own computer, with no API key in the browser. It is a small HTTP server on
`127.0.0.1` that speaks the OpenAI chat-completions protocol Mosaic's runtime already uses
(`vendor/nsdeploy-runtime/llm.js`, `LlmClient`), so the browser needs no change.

Each chat call is one model step. Link renders the system message, the transcript and the
tool list into a prompt, asks the local agent for `{text, tool_calls}`, and streams that
back as SSE (`delta.content`, `delta.tool_calls`, `finish_reason` `stop` or `tool_calls`).
The browser keeps the loop, the consent dialogs and the site tools. The local agent is only
the brain: it never runs a Mosaic tool itself.

## Setup

1. Install and sign in to the agent you want (`claude`, or `codex`; for ACP, see below).
2. In this repo: `bun run link`. It prints the address and a pairing token. The token is
   also in `~/.config/mosaic/link-token` (mode 0600). It is kept across restarts;
   `bun run link --rotate` makes a new one.
3. In Mosaic, open AI model settings and enter:
   - Router: `http://127.0.0.1:4199/v1`
   - Key: the pairing token
   - Model: `claude-code`. Add `/<model>` to pick the agent's model, e.g. `claude-code/sonnet`.
4. A deployed Mosaic (not `http://localhost:4000`) also needs its origin allowed:
   `MOSAIC_LINK_ORIGINS=https://<host> bun run link`.

Only `claude-code` is on by default, because it is the only backend with no tools. The
others can read files, and a site's text reaches their prompt, so a hostile site could try
to make them read your files into an answer. Turn them on deliberately:
`bun run link --enable codex,acp` (or `MOSAIC_LINK_ENABLE=codex,acp`; `acp` means both ACP
backends). Link prints one warning per enabled backend. A model that is off gets a 400
naming the flag, and `/v1/models` lists only the enabled ones.

## Containment

| Backend | Default | Agent's own tools | Can read your files | Status |
| --- | --- | --- | --- | --- |
| `claude-code` | on | none (`--tools ""`, no MCP) | no | tested with the real CLI |
| `codex` | off (`--enable codex`) | shell, read-only sandbox | yes | tested with a fake CLI only |
| `claude-code-acp` | off (`--enable acp`) | the adapter's; permission requests refused | possibly, through tools that do not ask | experimental: untested with the real adapter |
| `codex-acp` | off (`--enable acp`) | the adapter's; permission requests refused | possibly, through tools that do not ask | experimental: untested with the real adapter |

Settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOSAIC_LINK_PORT` | `4199` | Port on 127.0.0.1 |
| `MOSAIC_LINK_ORIGINS` | `http://localhost:4000` | Comma-separated origins allowed to call Link. A deployed Mosaic needs `https://<host>` here. |
| `MOSAIC_LINK_ENABLE` | (empty) | Extra backends: `codex`, `acp`, `claude-code-acp`, `codex-acp`. Same as `--enable`. |
| `MOSAIC_LINK_CLAUDE_ACP` | `claude-agent-acp` | Command for `claude-code-acp` |
| `MOSAIC_LINK_CODEX_ACP` | `codex-acp` | Command for `codex-acp` |

Endpoints: `GET /v1/models`, `POST /v1/chat/completions`. Both need `Authorization: Bearer <token>`.

## Backends and where each flag comes from

**`claude-code`** runs, with the prompt on stdin:
`claude -p --output-format json --tools "" --strict-mcp-config --safe-mode --no-session-persistence --system-prompt <rules + agent instructions> --json-schema <step schema> [--model m]`
and reads `structured_output` (and `is_error`) from the result. Source: `claude --help`
(Claude Code 2.1.329): `--tools ""` means no built-in tools, `--strict-mcp-config` ignores
all MCP configs not given by `--mcp-config` (none is given), `--safe-mode` turns off
CLAUDE.md, skills, plugins, hooks and MCP servers, `--json-schema` validates structured
output. The lead checked the command and the `structured_output` field first. The
instructions travel as one argument, so they are capped at 120 KB (Linux limits one
argument to 128 KiB).

**`codex`** runs, with the prompt on stdin (`-`):
`codex exec --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --color never --output-schema <file> --output-last-message <file> --cd <empty dir> [--model m] -`
Source: `npx -y @openai/codex exec --help` (@openai/codex 0.171.0). `codex exec` has no
system-prompt flag, so the instructions go at the top of the prompt. `--ignore-user-config`
skips `~/.codex/config.toml` (so no user MCP servers); auth still uses `CODEX_HOME`. The
step schema keeps `arguments` as a JSON string because `--output-schema` uses OpenAI
structured outputs, which need a closed schema.

**`claude-code-acp`, `codex-acp`** (experimental, untested with the real adapters) speak the Agent Client Protocol (ACP) v1 over stdio:
newline-delimited JSON-RPC 2.0. Link sends `initialize` (`protocolVersion: 1`,
`clientCapabilities.fs.readTextFile/writeTextFile: false`, `terminal: false`),
`session/new` (`cwd`: an empty temp dir, `mcpServers: []`), `session/set_config_option`
when a `/model` is given and the agent offers a config option with category `model`, then
`session/prompt` with one text block. It joins the `session/update` notifications of kind
`agent_message_chunk` and expects `stopReason: "end_turn"`. Every
`session/request_permission` is answered with a `reject_once`/`reject_always` option, or
`cancelled` when none is offered; any other agent request (`fs/*`, `terminal/*`) gets
JSON-RPC error -32601. On disconnect Link sends `session/cancel` and kills the agent.
Sources: the stable schema `schema/v1/schema.json` in `@agentclientprotocol/sdk` 2.8.0 and
its `ndJsonStream` transport; protocol pages at https://agentclientprotocol.com/protocol/v1/.
Adapters, from `npm view`: `@agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`)
and `@agentclientprotocol/codex-acp` (bin `codex-acp`). The older `@zed-industries/*`
names are deprecated and point to these. Install one globally (`npm i -g ...`) or set the
command variable.

## Security

- Listens on 127.0.0.1 only, and refuses a `Host` header other than `127.0.0.1` or
  `localhost` (DNS rebinding).
- Every request but a CORS preflight needs the pairing token (constant-time compare).
- CORS answers only origins in `MOSAIC_LINK_ORIGINS`; any other `Origin` gets 403 before an
  agent starts. Preflights carry `Access-Control-Allow-Private-Network: true`.
- Agents run in a fresh empty temp directory, with their tools off (headless) or every
  permission refused (ACP).
- One step at a time (429 otherwise), 180 s limit (504), and the agent process is killed
  when the browser disconnects or the limit is reached.
- The log shows backend, tool-call count and time. It never shows prompt text or the token.

## Risks

- **Your subscription pays.** Every step of every Mosaic turn runs on your Claude or Codex
  account. A turn can take several steps.
- **A site's text reaches your agent.** Agent instructions, tool results and page content
  go into the prompt. A hostile page can try prompt injection. With headless `claude-code`
  the agent has no tools, so injected text can only change the answer, and the browser
  still asks before any site action.
- **Codex still has a shell.** `codex exec` has no flag to turn its tools off. The
  read-only sandbox stops writes, but Codex can still read files and run read-only
  commands, which makes it a prompt-injection exfiltration path. That is why it is off
  by default.
- **ACP adapters have their own tools.** Link refuses every permission request and offers
  no file or terminal access, but an adapter may run tools that do not ask (for example
  reads). That is why ACP is off by default.
- **Anyone with the token and an allowed origin can use your agent.** Keep the token
  private, keep `MOSAIC_LINK_ORIGINS` short, and rotate with `--rotate` if it leaks.

## Chrome's local-network prompt

When Mosaic runs on a public origin (not `localhost`), Chrome treats a request to
`127.0.0.1` as local network access. Newer Chrome versions show a permission prompt
asking whether the site may reach apps and devices on your computer or network; choose
Allow, or the request fails as a network error. Older versions send a CORS preflight with
`Access-Control-Request-Private-Network: true` instead, which Link answers. From
`http://localhost:4000` there is no prompt, since the page is already local. The page's
Content-Security-Policy `connect-src` allows `http://127.0.0.1:4199` and
`http://localhost:4199`.
