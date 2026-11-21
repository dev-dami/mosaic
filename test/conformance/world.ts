// The world the §6 conformance checks run in: a headless Mosaic agent on the vendored nsdeploy
// runtime (vendor/nsdeploy-runtime, unchanged), a stub fetch that serves every site's public files
// by URL and logs each request (URL, method, headers, body), and scripted OpenAI-compatible routers
// that play the model by which agent is asking. A turn is folded into Mosaic's runbook value with
// src/host/agentic/turn.ts, so a check can assert the exact problem row a person would see.
import { resolve } from "node:path";
import { MosaicAgent, type ConsentDecision, type ConsentRequest, type ModelSetup, type TraceEvent, type TurnEvent } from "../../src/host/agentic/engine";
import { buildHostNetwork, type SiteRef } from "../../src/host/agentic/network";
import { applyTrace, applyTurnEvent, startTurn, type AgentTurn, type TurnStep } from "../../src/host/agentic/turn";
import { fixtureFiles, type FixtureOrigins } from "../../providers/fixtures";

export const RUNTIME = resolve(import.meta.dir, "../../vendor/nsdeploy-runtime/engine.js");
export const HOST = "http://mosaic.test";
export const FIX: FixtureOrigins = { a: "http://fixtures-a.test", b: "http://fixtures-b.test", denied: "http://denied.test" };
export const BYOK_ROUTER = "http://byok-router.test/v1";
export const KEY = "otk_conformance_key_6";

export type Logged = { url: string; origin: string; method: string; headers: Record<string, string>; body: string };

/** One model request as the scripted router sees it. */
export type ModelAsk = {
  router: string;
  auth: string;
  model: string;
  tools: string[];
  system: string;
  /** The last user message: the request this agent was given. */
  user: string;
  /** Tool results since that user message: how far along this agent is. */
  results: number;
};
export type Reply = { content: string } | { call: string; args: Record<string, unknown> };
export type Script = (ask: ModelAsk) => Reply;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

function sse(model: string, reply: Reply): Response {
  const delta =
    "call" in reply
      ? { tool_calls: [{ index: 0, id: `call_${reply.call}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: reply.call, arguments: JSON.stringify(reply.args) } }] }
      : { content: reply.content };
  const chunks = [
    { model, choices: [{ delta, finish_reason: null }] },
    { model, choices: [{ delta: {}, finish_reason: "call" in reply ? "tool_calls" : "stop" }] },
  ];
  return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

export class World {
  readonly docs = new Map<string, unknown>();
  readonly log: Logged[] = [];
  /** Router base URL (no trailing slash) → script. */
  readonly routers = new Map<string, Script>();
  /** Extra handlers by origin, for a site's own API. */
  readonly handlers = new Map<string, (req: Request) => Response | Promise<Response>>();
  private readonly realFetch = globalThis.fetch;

  serve(origin: string, files: Record<string, unknown>) {
    for (const [path, body] of Object.entries(files)) this.docs.set(`${origin}${path}`, body);
    return this;
  }

  /** Mosaic's host files, linking each site by its slug; `edit` may change them first. */
  serveHost(sites: SiteRef[], edit?: (files: ReturnType<typeof buildHostNetwork>) => void) {
    const files = buildHostNetwork({ sites });
    edit?.(files);
    const { agentManifest, network, links } = files;
    return this.serve(HOST, { "/agent-manifest.json": agentManifest, "/mosaic.network.json": network, "/links.json": links });
  }

  serveFixtures() {
    return this.serve(FIX.a, fixtureFiles("a", FIX)).serve(FIX.b, fixtureFiles("b", FIX));
  }

  install() {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.clone().text();
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => (headers[k] = v));
      this.log.push({ url: url.href, origin: url.origin, method: req.method, headers, body });
      const router = [...this.routers.keys()].find((base) => url.href === `${base}/chat/completions`);
      if (router) return this.answer(router, headers, body);
      const handler = this.handlers.get(url.origin);
      if (handler) return handler(req);
      if (this.docs.has(url.href)) return json(this.docs.get(url.href));
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return this;
  }

  restore() {
    globalThis.fetch = this.realFetch;
  }

  private answer(router: string, headers: Record<string, string>, raw: string): Response {
    const body = JSON.parse(raw || "{}") as { model: string; tools?: { function: { name: string } }[]; messages?: { role: string; content?: unknown }[] };
    const messages = body.messages ?? [];
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const ask: ModelAsk = {
      router,
      auth: headers.authorization ?? "",
      model: body.model,
      tools: (body.tools ?? []).map((t) => t.function.name),
      system: String(messages.find((m) => m.role === "system")?.content ?? ""),
      user: String(messages[lastUser]?.content ?? ""),
      results: messages.slice(lastUser + 1).filter((m) => m.role === "tool").length,
    };
    return sse(body.model, this.routers.get(router)!(ask));
  }

  /** Requests whose origin is one of `origins`. */
  to(...origins: string[]) {
    return this.log.filter((r) => origins.includes(r.origin));
  }

  /** Model requests, to any router. */
  modelCalls() {
    return this.log.filter((r) => r.url.endsWith("/chat/completions"));
  }
}

export type Consents = { asked: ConsentRequest[]; answer: (req: ConsentRequest) => ConsentDecision };

export async function createAgent(setup: ModelSetup, consents: Consents = { asked: [], answer: () => "allow" }) {
  return MosaicAgent.create({
    setup,
    originUrl: HOST,
    runtimeUrl: RUNTIME,
    onConsent: async (req) => {
      consents.asked.push(req);
      return consents.answer(req);
    },
  });
}

export type TurnRun = { turn: AgentTurn; trace: TraceEvent[]; events: TurnEvent[]; problems: [string, string][] };

/** Runs one turn to its end and folds it into Mosaic's runbook value (turn.ts). */
export async function runTurn(agent: MosaicAgent, text: string, slyData: Record<string, unknown> = {}): Promise<TurnRun> {
  let turn = startTurn(text);
  const trace: TraceEvent[] = [];
  const events: TurnEvent[] = [];
  const off = agent.subscribe((ev) => {
    trace.push(ev);
    turn = applyTrace(turn, ev);
  });
  try {
    for await (const ev of agent.runTurn(text, slyData)) {
      events.push(ev);
      turn = applyTurnEvent(turn, ev);
    }
  } finally {
    off();
  }
  const problems = turn.steps.filter((s): s is Extract<TurnStep, { kind: "problem" }> => s.kind === "problem").map((p) => [p.target, p.message] as [string, string]);
  return { turn, trace, events, problems };
}

/** The script for a peer front agent: answer at once. */
export const answers = (text: string): Reply => ({ content: text });
