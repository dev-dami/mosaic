// Mosaic Link (C19): the local bridge that answers Mosaic's OpenAI-format chat calls with
// one step from a local agent CLI. Fake CLIs in test/link-bin stand in for claude, codex
// and an ACP agent; the runtime's own LlmClient reads the bridge's SSE.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnable, startLink } from "../link/server.ts";
import { loadToken } from "../link/main.ts";
import { parseModel, parseStep, renderPrompt } from "../link/protocol.ts";
import { rejectPermission } from "../link/acp.ts";

const BIN = resolve(import.meta.dir, "link-bin");
const LLM = resolve(import.meta.dir, "../vendor/nsdeploy-runtime/llm.js");
const TOKEN = "mlk_test_token_0123456789abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "http://localhost:4000";
const TOOLS = [
  { type: "function", function: { name: "lookup", description: "Look a thing up.", parameters: { type: "object", properties: { q: { type: "string" } } } } },
  { type: "function", function: { name: "website_add", description: "Add an item.", parameters: { type: "object", properties: { item: { type: "string" } } } } },
];
const MESSAGES = [
  { role: "system", content: "You are the tea shop's agent." },
  { role: "user", content: "find tea" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"tea\"}" } }] },
  { role: "tool", tool_call_id: "call_1", name: "lookup", content: "green tea, black tea" },
];

let scratch = "";
const dirs: string[] = [];
let servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(async () => {
  for (const s of servers) s.stop(true);
  servers = [];
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  scratch = "";
});

const ALL = new Set(["claude-code", "codex", "claude-code-acp", "codex-acp"] as const);

async function link(extraEnv: Record<string, string> = {}, timeoutMs?: number, enabled?: Set<"claude-code" | "codex" | "claude-code-acp" | "codex-acp">) {
  const dir = (scratch = await mkdtemp(join(tmpdir(), "link-test-")));
  dirs.push(dir);
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_RECORD: join(scratch, "record"), FAKE_PID: join(scratch, "pid"), ...extraEnv };
  const logs: string[] = [];
  const server = startLink({ port: 0, token: TOKEN, origins: [ORIGIN], enabled, env, timeoutMs, log: (l) => logs.push(l) });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}/v1`, logs, record: () => readFile(join(dir, "record"), "utf8"), pidFile: join(dir, "pid") };
}

const post = (base: string, body: unknown, init: RequestInit = {}) =>
  fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string>) },
    body: JSON.stringify(body),
    signal: init.signal,
  });

async function client(base: string) {
  const { LlmClient } = await import(LLM);
  return new LlmClient({ baseUrl: base, apiKey: TOKEN });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(fn: () => Promise<T | undefined> | T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== false) return v as T;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await Bun.sleep(25);
  }
}

const readPid = (file: string) => waitFor(async () => {
  const n = Number((await readFile(file, "utf8").catch(() => "")).trim());
  return n > 0 ? n : undefined;
});

describe("protocol translation", () => {
  test("model names pick a backend and an optional model", () => {
    expect(parseModel("claude-code")).toEqual({ backend: "claude-code" });
    expect(parseModel("claude-code/sonnet")).toEqual({ backend: "claude-code", model: "sonnet" });
    expect(parseModel("codex-acp/gpt-5.2")).toEqual({ backend: "codex-acp", model: "gpt-5.2" });
    expect(parseModel("gpt-4o")).toBeNull();
    expect(parseModel("codex/--sandbox danger")).toBeNull();
  }, 1000);

  test("the transcript, tool calls, tool results and tools reach the prompt", () => {
    const { system, prompt } = renderPrompt(MESSAGES, TOOLS);
    expect(system).toContain("You are the tea shop's agent.");
    expect(system).toContain("Answer only with a JSON object");
    expect(prompt).toContain("[user]\nfind tea");
    expect(prompt).toContain("called tool lookup with id call_1");
    expect(prompt).toContain("[tool result for call_1 (lookup)]\ngreen tea, black tea");
    expect(prompt).toContain("- website_add: Add an item.");
    expect(prompt).not.toContain("tea shop's agent");
  }, 1000);

  test("a step keeps listed tools only and accepts object or string arguments", () => {
    const names = new Set(["lookup"]);
    const step = parseStep({ text: "", tool_calls: [{ name: "lookup", arguments: { q: 1 } }, { name: "rm_rf", arguments: "{}" }] }, names);
    expect(step.toolCalls).toEqual([{ name: "lookup", arguments: "{\"q\":1}" }]);
    expect(step.dropped).toBe(1);
    expect(parseStep("```json\n{\"text\":\"hi\",\"tool_calls\":[]}\n```", names).text).toBe("hi");
    expect(parseStep("plain words", names)).toEqual({ text: "plain words", toolCalls: [], dropped: 0 });
  }, 1000);

  test("permission requests are always rejected", () => {
    expect(rejectPermission([{ optionId: "a", kind: "allow_once" }, { optionId: "r", kind: "reject_always" }])).toEqual({ outcome: { outcome: "selected", optionId: "r" } });
    expect(rejectPermission([{ optionId: "a", kind: "allow_always" }])).toEqual({ outcome: { outcome: "cancelled" } });
  }, 1000);
});

describe("claude-code through the runtime's LlmClient", () => {
  test("tool calls stream as delta.tool_calls with finish_reason tool_calls", async () => {
    const { base, record, logs } = await link({ FAKE_MODE: "tools" });
    const res = await (await client(base)).chat({ model: "claude-code", messages: MESSAGES, tools: TOOLS });
    expect(res.finishReason).toBe("tool_calls");
    expect(res.toolCalls.map((t: any) => t.function.name)).toEqual(["lookup", "website_add"]);
    expect(JSON.parse(res.toolCalls[1].function.arguments)).toEqual({ item: "cup" });
    expect(res.toolCalls[0].id).toMatch(/^call_/);
    expect(res.toolCalls[0].id).not.toBe(res.toolCalls[1].id);
    expect(res.model).toBe("mosaic-link/claude-code");

    const rec = JSON.parse(await record());
    const argv: string[] = rec.argv;
    expect(argv.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    for (const flag of ["--strict-mcp-config", "--safe-mode", "--no-session-persistence", "--json-schema"]) expect(argv).toContain(flag);
    expect(argv[argv.indexOf("--system-prompt") + 1]).toContain("tea shop's agent");
    expect(rec.stdin).toContain("green tea, black tea");
    expect(rec.cwd).toContain("mosaic-link-");
    // The log names counts, never prompt text or the token.
    expect(logs.join("\n")).toContain("dropped=1");
    expect(logs.join("\n")).not.toContain("tea");
    expect(logs.join("\n")).not.toContain(TOKEN);
  }, 10_000);

  test("a text answer streams as content with finish_reason stop, and /model is passed on", async () => {
    const { base, record } = await link({ FAKE_MODE: "text" });
    const deltas: string[] = [];
    const res = await (await client(base)).chat({ model: "claude-code/sonnet", messages: MESSAGES.slice(0, 2), tools: TOOLS, onContentDelta: (t: string) => deltas.push(t) });
    expect(res.finishReason).toBe("stop");
    expect(res.content).toBe("hello from fake claude");
    expect(deltas.join("")).toBe("hello from fake claude");
    const argv: string[] = JSON.parse(await record()).argv;
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
  }, 10_000);

  test("an agent error comes back as an HTTP error, not as an answer", async () => {
    const { base } = await link({ FAKE_MODE: "error" });
    const res = await post(base, { model: "claude-code", messages: MESSAGES, stream: true });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("not logged in");
  }, 10_000);
});

describe("security", () => {
  test("a missing or wrong token is refused", async () => {
    const { base } = await link();
    expect((await fetch(`${base}/models`)).status).toBe(401);
    expect((await fetch(`${base}/models`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await post(base, { model: "claude-code", messages: [] }, { headers: { authorization: `Bearer ${TOKEN}x` } })).status).toBe(401);
    const ok = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.map((m: any) => m.id)).toEqual(["claude-code"]);
  }, 5000);

  test("only claude-code is on by default; the others need --enable", async () => {
    expect([...parseEnable(undefined)]).toEqual(["claude-code"]);
    expect([...parseEnable("codex")].sort()).toEqual(["claude-code", "codex"]);
    expect([...parseEnable("acp")].sort()).toEqual(["claude-code", "claude-code-acp", "codex-acp"]);
    expect(() => parseEnable("codex,bash")).toThrow("unknown backend");

    const { base, record } = await link({ MOSAIC_LINK_CLAUDE_ACP: join(BIN, "fake-acp") });
    const codex = await post(base, { model: "codex", messages: MESSAGES });
    expect(codex.status).toBe(400);
    expect((await codex.json()).error.message).toContain("--enable codex");
    const acp = await post(base, { model: "claude-code-acp/opus", messages: MESSAGES });
    expect(acp.status).toBe(400);
    expect((await acp.json()).error.message).toContain("--enable acp");
    expect(await record().catch(() => "never ran")).toBe("never ran");

    const { base: base2 } = await link({}, undefined, parseEnable("codex,acp"));
    const models = await (await fetch(`${base2}/models`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(models.data.map((m: any) => m.id)).toEqual(["claude-code", "codex", "claude-code-acp", "codex-acp"]);
  }, 5000);

  test("only listed origins get CORS, and preflight allows the private network", async () => {
    const { base } = await link();
    const pre = await fetch(`${base}/chat/completions`, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-private-network": "true" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");

    const evilPre = await fetch(`${base}/chat/completions`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(evilPre.status).toBe(403);
    expect(evilPre.headers.get("access-control-allow-origin")).toBeNull();
    // Even with the token, a request from another origin is refused before any agent runs.
    const evil = await post(base, { model: "claude-code", messages: MESSAGES }, { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
  }, 5000);

  test("a non-loopback Host header is refused (DNS rebinding)", async () => {
    const { base } = await link();
    const res = await fetch(`${base}/models`, { headers: { host: "evil.example", authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(421);
  }, 5000);

  test("a second request while one runs gets 429; disconnecting kills the child", async () => {
    const { base, pidFile } = await link({ FAKE_MODE: "sleep" });
    const ac = new AbortController();
    const first = post(base, { model: "claude-code", messages: MESSAGES }, { signal: ac.signal }).catch((e) => e);
    const pid = await readPid(pidFile);
    expect(alive(pid)).toBe(true);
    expect((await post(base, { model: "claude-code", messages: MESSAGES })).status).toBe(429);
    ac.abort();
    await first;
    await waitFor(() => !alive(pid), 5000);
    // The slot frees once the child is gone.
    await waitFor(async () => (await post(base, { model: "nope", messages: [] })).status === 400 || undefined);
  }, 15_000);

  test("a failure to make the temp folder frees the slot (no stuck 429)", async () => {
    const { base } = await link();
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = "/nonexistent/mosaic-link-test";
    try {
      expect((await post(base, { model: "claude-code", messages: MESSAGES })).status).toBe(500);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    expect((await post(base, { model: "claude-code", messages: MESSAGES })).status).not.toBe(429);
  }, 15_000);

  test("a step past the timeout returns 504 and the child is killed", async () => {
    const { base, pidFile } = await link({ FAKE_MODE: "sleep" }, 800);
    const resP = post(base, { model: "claude-code", messages: MESSAGES });
    const pid = await readPid(pidFile);
    const res = await resP;
    expect(res.status).toBe(504);
    await waitFor(() => !alive(pid), 5000);
  }, 10_000);

  test("the pairing token file is 0600 and survives restarts unless rotated", async () => {
    scratch = await mkdtemp(join(tmpdir(), "link-token-"));
    dirs.push(scratch);
    const file = join(scratch, "mosaic", "link-token");
    const a = await loadToken(file, false);
    expect(a).toMatch(/^mlk_[A-Za-z0-9_-]{40,}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await loadToken(file, false)).toBe(a);
    expect(await loadToken(file, true)).not.toBe(a);
  }, 5000);
});

describe("codex", () => {
  test("codex exec runs read-only with an output schema and the prompt on stdin", async () => {
    const { base, record } = await link({}, undefined, ALL);
    const res = await (await client(base)).chat({ model: "codex", messages: MESSAGES, tools: TOOLS });
    expect(res.finishReason).toBe("tool_calls");
    expect(JSON.parse(res.toolCalls[0].function.arguments)).toEqual({ q: "codex" });
    const rec = JSON.parse(await record());
    const argv: string[] = rec.argv;
    expect(argv[0]).toBe("exec");
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
    for (const flag of ["--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--output-schema"]) expect(argv).toContain(flag);
    expect(argv.at(-1)).toBe("-");
    expect(rec.stdin).toContain("<instructions>");
    expect(rec.stdin).toContain("green tea, black tea");
  }, 10_000);
});

describe("ACP", () => {
  test("handshake: no fs or terminal, no MCP servers, permissions rejected, chunks joined", async () => {
    const { base, record } = await link({ MOSAIC_LINK_CLAUDE_ACP: join(BIN, "fake-acp") }, undefined, ALL);
    const res = await (await client(base)).chat({ model: "claude-code-acp/opus", messages: MESSAGES, tools: TOOLS });
    expect(res.content).toBe("acp says hi");
    expect(res.toolCalls.map((t: any) => t.function.name)).toEqual(["lookup"]);

    const lines = (await record()).trim().split("\n").map((l) => JSON.parse(l));
    const init = lines.find((l) => l.got === "initialize");
    expect(init.params.protocolVersion).toBe(1);
    expect(init.params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    const session = lines.find((l) => l.got === "session/new");
    expect(session.params.mcpServers).toEqual([]);
    expect(session.params.cwd).toContain("mosaic-link-");
    expect(lines.find((l) => l.got === "session/set_config_option").params).toEqual({ sessionId: "s1", configId: "model", value: "opus" });
    const responses = lines.filter((l) => l.got === "response");
    expect(responses[0].result).toEqual({ outcome: { outcome: "selected", optionId: "no" } });
    expect(responses[1].error.code).toBe(-32601);
    expect(lines.find((l) => l.got === "session/prompt").params.prompt[0].text).toContain("green tea, black tea");
  }, 10_000);

  test("disconnecting sends session/cancel and kills the ACP agent", async () => {
    const { base, pidFile, record } = await link({ MOSAIC_LINK_CODEX_ACP: join(BIN, "fake-acp"), FAKE_MODE: "sleep" }, undefined, ALL);
    const ac = new AbortController();
    const req = post(base, { model: "codex-acp", messages: MESSAGES }, { signal: ac.signal }).catch((e) => e);
    const pid = await readPid(pidFile);
    ac.abort();
    await req;
    await waitFor(() => !alive(pid), 5000);
    expect(await record()).toContain("session/cancel");
  }, 10_000);
});
