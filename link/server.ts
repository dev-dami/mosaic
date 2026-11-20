// Mosaic Link's HTTP server: an OpenAI-compatible endpoint on 127.0.0.1 that answers each
// chat call with one step from a local agent CLI. See docs/local-agents.md.

import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackend, type StepInput } from "./backends.ts";
import { StepError } from "./child.ts";
import { BACKENDS, parseModel, parseStep, renderPrompt, stepToSse, type Backend, type ChatMessage, type ChatRequest, type ChatTool } from "./protocol.ts";

export type LinkOptions = {
  port: number;
  token: string;
  origins: string[];
  enabled?: Set<Backend>; // default: claude-code only (tools off)
  timeoutMs?: number;
  env?: Record<string, string | undefined>; // the environment agents run with
  log?: (line: string) => void;
  // Swappable for tests; the default runs the real CLIs.
  run?: (backend: Backend, input: StepInput) => Promise<unknown>;
};

const MAX_BODY = 4 * 1024 * 1024;

// Backends that can read files are a prompt-injection exfiltration path (a site's text
// reaches the prompt), so only tool-less headless claude-code is on by default.
export const DEFAULT_ENABLED: readonly Backend[] = ["claude-code"];

export const ENABLE_WARNINGS: Record<Backend, string> = {
  "claude-code": "",
  codex: "codex is enabled: Codex keeps a read-only shell, so a hostile site's text could make it read your files into the answer.",
  "claude-code-acp": "claude-code-acp is enabled (experimental): the adapter may run tools that do not ask permission, such as file reads.",
  "codex-acp": "codex-acp is enabled (experimental): the adapter may run tools that do not ask permission, such as file reads.",
};

/**
 * Read `--enable` / MOSAIC_LINK_ENABLE: comma-separated backend names, where "acp" means
 * both ACP backends. claude-code is always on.
 *
 * :param value: The list, e.g. "codex,acp"; empty or undefined for the default.
 * :return: The enabled backends.
 * :raises Error: For an unknown name.
 */
export function parseEnable(value: string | undefined): Set<Backend> {
  const enabled = new Set<Backend>(DEFAULT_ENABLED);
  for (const raw of (value || "").split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (name === "acp") {
      enabled.add("claude-code-acp");
      enabled.add("codex-acp");
    } else if ((BACKENDS as readonly string[]).includes(name)) enabled.add(name as Backend);
    else throw new Error(`unknown backend in --enable: ${name} (use codex, acp, claude-code-acp, codex-acp)`);
  }
  return enabled;
}

/**
 * Compare a presented bearer token with the pairing token in constant time.
 *
 * :param header: The Authorization header, or null.
 * :param token: The pairing token.
 * :return: True when the header is "Bearer <token>".
 */
export function tokenMatches(header: string | null, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header || "");
  const given = createHash("sha256").update(m?.[1] ?? "").digest();
  const want = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, want) && !!m && token.length > 0;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function errorBody(message: string, type = "mosaic_link_error") {
  return { error: { message, type } };
}

export function startLink(opts: LinkOptions) {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const run = opts.run ?? runBackend;
  const allowed = new Set(opts.origins);
  const enabled = opts.enabled ?? new Set(DEFAULT_ENABLED);
  const listed = BACKENDS.filter((b) => enabled.has(b));
  let busy = false;

  const corsHeaders = (origin: string): Record<string, string> => ({
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  });

  async function chat(req: Request, cors: Record<string, string>): Promise<Response> {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json(413, errorBody("request too large"), cors);
    let body: ChatRequest;
    try {
      body = (await req.json()) as ChatRequest;
    } catch {
      return json(400, errorBody("the body is not JSON"), cors);
    }
    const picked = parseModel(body.model);
    if (!picked) return json(400, errorBody(`unknown model; use one of ${listed.join(", ")}, optionally with /<model>`), cors);
    if (!enabled.has(picked.backend)) {
      const flag = picked.backend === "codex" ? "codex" : "acp";
      return json(400, errorBody(`${picked.backend} is off; start Mosaic Link with \`bun run link --enable ${flag}\` (or MOSAIC_LINK_ENABLE=${flag}) to use it`), cors);
    }
    if (!Array.isArray(body.messages)) return json(400, errorBody("messages must be an array"), cors);
    const messages = body.messages as ChatMessage[];
    const tools = (Array.isArray(body.tools) ? body.tools : []) as ChatTool[];
    const toolNames = new Set(tools.map((t) => t?.function?.name).filter((n): n is string => typeof n === "string"));

    if (busy) return json(429, errorBody("Mosaic Link is already running a step; try again when it finishes"), cors);
    busy = true;
    const started = Date.now();
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
    const cwd = await mkdtemp(join(tmpdir(), "mosaic-link-"));
    let status = 200;
    try {
      const { system, prompt } = renderPrompt(messages, tools);
      const raw = await run(picked.backend, { system, prompt, model: picked.model, cwd, env, signal });
      const step = parseStep(raw, toolNames);
      if (!step.text && !step.toolCalls.length) {
        status = 502;
        return json(502, errorBody("the local agent gave an empty answer"), cors);
      }
      log(`step ok backend=${picked.backend} tool_calls=${step.toolCalls.length} dropped=${step.dropped} ms=${Date.now() - started}`);
      const name = `mosaic-link/${picked.backend}${picked.model ? `/${picked.model}` : ""}`;
      return new Response(stepToSse(step, name), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors },
      });
    } catch (err) {
      status = err instanceof StepError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      log(`step failed backend=${picked.backend} status=${status} ms=${Date.now() - started}`);
      return json(status, errorBody(message), cors);
    } finally {
      busy = false;
      await rm(cwd, { recursive: true, force: true });
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 0, // a step can take minutes; the timeout above bounds it
    async fetch(req) {
      const url = new URL(req.url);
      // DNS rebinding guard: only the loopback names reach the handlers.
      const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
      if (host !== "127.0.0.1" && host !== "localhost") return json(421, errorBody("wrong host"));

      const origin = req.headers.get("origin");
      if (origin !== null && !allowed.has(origin)) {
        log(`refused origin ${req.method} ${url.pathname}`);
        return json(403, errorBody("this origin is not allowed; add it to MOSAIC_LINK_ORIGINS"));
      }
      const cors = origin ? corsHeaders(origin) : {};

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Max-Age": "600",
          },
        });
      }

      if (!tokenMatches(req.headers.get("authorization"), opts.token)) {
        log(`refused token ${req.method} ${url.pathname}`);
        return json(401, errorBody("missing or wrong pairing token"), cors);
      }

      const path = url.pathname.replace(/\/+$/, "");
      if (req.method === "GET" && path === "/v1/models") {
        const created = Math.floor(Date.now() / 1000);
        return json(200, { object: "list", data: listed.map((id) => ({ id, object: "model", created, owned_by: "mosaic-link" })) }, cors);
      }
      if (req.method === "POST" && path === "/v1/chat/completions") return chat(req, cors);
      return json(404, errorBody("not found"), cors);
    },
  });
  return server;
}
