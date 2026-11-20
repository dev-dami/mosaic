// The local agents Mosaic Link can ask for one step. Each backend takes the rendered
// prompt and returns the agent's raw answer (structured output or final text); the
// server turns it into a step with parseStep. Flag sources are in docs/local-agents.md.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpStep } from "./acp.ts";
import { runOnce, StepError } from "./child.ts";
import { STEP_SCHEMA, type Backend } from "./protocol.ts";

export type StepInput = {
  system: string;
  prompt: string;
  model?: string;
  cwd: string; // an empty temp directory the agent runs in
  env: Record<string, string | undefined>;
  signal: AbortSignal;
};

// Linux caps one argv string at 128 KiB (MAX_ARG_STRLEN); stay under it.
const MAX_ARG = 120_000;

/**
 * Headless Claude Code: `claude -p` with built-in tools off, no MCP servers, no
 * customizations, no saved session, and a JSON schema for the answer. Prompt on stdin.
 */
export async function claudeHeadless(input: StepInput): Promise<unknown> {
  if (Buffer.byteLength(input.system) > MAX_ARG) throw new StepError("the agent instructions are too long for claude --system-prompt", 413);
  const cmd = [
    "claude", "-p",
    "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config",
    "--safe-mode",
    "--no-session-persistence",
    "--system-prompt", input.system,
    "--json-schema", JSON.stringify(STEP_SCHEMA),
    ...(input.model ? ["--model", input.model] : []),
  ];
  const { code, stdout, stderr } = await runOnce(cmd, { cwd: input.cwd, env: input.env, stdin: input.prompt, signal: input.signal });
  let out: { is_error?: boolean; structured_output?: unknown; result?: unknown };
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new StepError(`claude exited with ${code} and no JSON result${stderr ? `: ${stderr.trim()}` : ""}`);
  }
  if (out.is_error) throw new StepError(`claude reported an error: ${String(out.result ?? "").slice(0, 300)}`);
  if (out.structured_output !== undefined) return out.structured_output;
  if (typeof out.result === "string") return out.result;
  throw new StepError("claude returned no structured output");
}

/**
 * Headless Codex: `codex exec` with a read-only sandbox, no saved session, no user
 * config (so no user MCP servers), and an output schema. Prompt on stdin ("-"); the last
 * message is written to a file outside the agent's working directory.
 */
export async function codexHeadless(input: StepInput): Promise<unknown> {
  const scratch = await mkdtemp(join(tmpdir(), "mosaic-link-io-"));
  try {
    const schemaFile = join(scratch, "schema.json");
    const outFile = join(scratch, "last-message.json");
    await writeFile(schemaFile, JSON.stringify(STEP_SCHEMA), { mode: 0o600 });
    const cmd = [
      "codex", "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--color", "never",
      "--output-schema", schemaFile,
      "--output-last-message", outFile,
      "--cd", input.cwd,
      ...(input.model ? ["--model", input.model] : []),
      "-",
    ];
    // codex exec has no system-prompt flag, so the instructions lead the prompt.
    const stdin = `<instructions>\n${input.system}\n</instructions>\n\n${input.prompt}`;
    const { code, stderr } = await runOnce(cmd, { cwd: input.cwd, env: input.env, stdin, signal: input.signal });
    const last = await readFile(outFile, "utf8").catch(() => "");
    if (!last.trim()) throw new StepError(`codex exited with ${code} and no answer${stderr ? `: ${stderr.trim()}` : ""}`);
    return last;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ACP adapters, run as long-lived stdio JSON-RPC agents, one process per step.
// Override the commands with MOSAIC_LINK_CLAUDE_ACP / MOSAIC_LINK_CODEX_ACP (space-separated argv).
function acpCommand(env: Record<string, string | undefined>, key: string, fallback: string): string[] {
  const raw = env[key]?.trim();
  return raw ? raw.split(/\s+/) : [fallback];
}

export function runBackend(backend: Backend, input: StepInput): Promise<unknown> {
  switch (backend) {
    case "claude-code":
      return claudeHeadless(input);
    case "codex":
      return codexHeadless(input);
    case "claude-code-acp":
      return runAcpStep(acpCommand(input.env, "MOSAIC_LINK_CLAUDE_ACP", "claude-agent-acp"), input);
    case "codex-acp":
      return runAcpStep(acpCommand(input.env, "MOSAIC_LINK_CODEX_ACP", "codex-acp"), input);
  }
}
