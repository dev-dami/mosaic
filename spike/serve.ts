// SPIKE (throwaway, C1): hand-written MVP 0.3 artifacts for Pagewright plus a host page, served
// beside a scripted OpenAI-compatible mock router. Not production code; C3/C4 replace it.
// Run: bun spike/serve.ts   (ports 4000 host, 4101 Pagewright, 4111 chain peers, 4199 router)
import { docsSite } from "../providers/docs";
import { createSite } from "../providers/site";
import { runtimeRoute } from "../src/runtime-files";

const HOST = "http://localhost:4000";
const PW = "http://localhost:4101";
const CHAIN = "http://localhost:4111";
const ROUTER = "http://localhost:4199/v1";
const cors = { "access-control-allow-origin": "*" };
const json = (v: unknown) => Response.json(v, { headers: cors });
const llm_router = { base_url: ROUTER, mock: true, byok_router: ROUTER };

const front = (name: string, tools: string[], extra: object = {}) => ({
  llm_config: { model_name: "mock-1" },
  max_steps: 12,
  tools: [
    {
      name,
      function: { description: `The ${name} assistant.`, parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
      instructions: `You are ${name}. Facts come only from tool results.`,
      tools,
      ...extra,
    },
  ],
});

// ---- Host (:4000): /h1 is the R0/R2 host network, /h5 the R1 five-peer chain.
const hostArtifacts: Record<string, unknown> = {
  "/h1/agent-manifest.json": {
    networks: [{ name: "mosaic", front_man: "mosaic", hocon: "./mosaic.network.json" }],
    llm_router,
    allowed_peers: [],
    peer_policy: { mode: "closed" },
  },
  "/h1/mosaic.network.json": {
    ...front("mosaic", ["pagewright_slot", "extra_1", "extra_2"], { allow: { to_downstream: { sly_data: ["project", "version"] } } }),
    link_slots: { pagewright_slot: {}, extra_1: {}, extra_2: {} },
  },
  "/h1/links.json": { version: 1, networks: { mosaic: {} } },
  "/h5/agent-manifest.json": {
    networks: [{ name: "chain", front_man: "chain", hocon: "./chain.network.json" }],
    llm_router,
    allowed_peers: [PW, CHAIN],
    peer_policy: { mode: "closed" },
  },
  "/h5/chain.network.json": front("chain", [`${PW}/pagewright`, `${CHAIN}/pw2`, `${CHAIN}/pw3`, `${CHAIN}/pw4`, `${CHAIN}/pw5`]),
  "/h5/links.json": { version: 1, networks: { chain: {} } },
};

const hostPage = `<!doctype html><meta charset="utf-8"><title>spike host</title><body><h1>spike host</h1>
<script type="module">
  window.__rt = await import("/runtime/index.js");
  window.__transport = await import("/runtime/action-transport.js");
  window.__ready = true;
</script>`;

Bun.serve({
  port: 4000,
  routes: {
    ...runtimeRoute,
    "/spike.html": () => new Response(hostPage, { headers: { "content-type": "text/html" } }),
    "/*": (req) => {
      const v = hostArtifacts[new URL(req.url).pathname];
      return v ? json(v) : new Response("nope", { status: 404 });
    },
  },
});

// ---- Pagewright (:4101): agent-manifest, network, links, bridge.
const site = createSite(docsSite, PW, [HOST]);
const pwArtifacts: Record<string, unknown> = {
  "/agent-manifest.json": {
    networks: [{ name: "pagewright", front_man: "pagewright_assistant", hocon: "./pagewright.network.json", description: docsSite.description }],
    llm_router,
    allowed_peers: [],
    peer_policy: { mode: "closed" },
    brand: { name: "Pagewright" },
    actions: { version: 1, bridge: "./bridge/action-bridge.html", agentTools: ["preview-docs-update", "apply-docs-update"] },
    linking: { protocol: "nsdeploy-link/v1", exports: [{ network: "pagewright", front_man: "pagewright_assistant", aliases: ["pagewright"], url: "pagewright" }] },
  },
  "/pagewright.network.json": front("pagewright_assistant", []),
  "/links.json": { version: 1, networks: { pagewright: {} } },
};
const bridgeManifest = { networks: [{ name: "pagewright" }], actions: { version: 1, module: "./bridge-actions.js" } };
const bridgeHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Action bridge</title>
<script type="module" src="../runtime/action-bridge.js"></script></head><body></body></html>`;
const strip = (s: any) => JSON.parse(JSON.stringify(s));
// Schemas: Mosaic's, as-is (x-mosaic-widget and default pass checkSchema; see check-schemas.ts).
const [preview, apply] = docsSite.capabilities;
const bridgeActions = `
const post = async (id, args) => {
  const r = await fetch("/api/capabilities/" + id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) return { ok: false, reason: await r.text() };
  return r.json();
};
export function registerActions(actions) {
  actions.register({ name: ${JSON.stringify(preview!.id)}, description: ${JSON.stringify(preview!.description)},
    inputSchema: ${JSON.stringify(strip(preview!.input_schema))}, effect: "read", availability: "bridge",
    callerOrigins: [${JSON.stringify(HOST)}], execute: (args) => post(${JSON.stringify(preview!.id)}, args) });
  actions.register({ name: ${JSON.stringify(apply!.id)}, description: ${JSON.stringify(apply!.description)},
    inputSchema: ${JSON.stringify(strip(apply!.input_schema))}, effect: "irreversible", availability: "bridge",
    callerOrigins: [${JSON.stringify(HOST)}], confirmsInWindow: true,
    execute: (args) => new Promise((resolve) => {
      const b = document.createElement("button"); b.id = "approve"; b.textContent = "Approve " + args.version;
      b.onclick = async () => resolve(await post(${JSON.stringify(apply!.id)}, args));
      document.body.append(b);
    }) });
}`;

Bun.serve({
  port: 4101,
  routes: {
    ...runtimeRoute,
    "/bridge/agent-manifest.json": () => Response.json(bridgeManifest),
    "/bridge/action-bridge.html": () => new Response(bridgeHtml, { headers: { "content-type": "text/html", "content-security-policy": `frame-ancestors ${HOST}` } }),
    "/bridge/bridge-actions.js": () => new Response(bridgeActions, { headers: { "content-type": "text/javascript" } }),
    "/api/capabilities/:id": { POST: (req) => site.handleApi(req, req.params.id) },
    "/*": (req) => {
      const v = pwArtifacts[new URL(req.url).pathname];
      return v ? json(v) : new Response("nope", { status: 404 });
    },
  },
});

// ---- Chain peers (:4111): four more networks, no actions.
const chainNames = ["pw2", "pw3", "pw4", "pw5"];
const chainArtifacts: Record<string, unknown> = {
  "/agent-manifest.json": { networks: chainNames.map((n) => ({ name: n, front_man: n, hocon: `./${n}.network.json` })), llm_router, allowed_peers: [], peer_policy: { mode: "closed" } },
  "/links.json": { version: 1, networks: {} },
  ...Object.fromEntries(chainNames.map((n) => [`/${n}.network.json`, front(n, [])])),
};
Bun.serve({
  port: 4111,
  fetch: (req) => {
    const v = chainArtifacts[new URL(req.url).pathname];
    return v ? json(v) : new Response("nope", { status: 404, headers: cors });
  },
});

// ---- Mock router (:4199): scripted, OpenAI-compatible, streams SSE.
type Msg = { role: string; content?: string; tool_calls?: unknown[] };
const records: { tools: string[]; lastUser: string; auth: boolean }[] = [];
function reply(body: { messages: Msg[]; tools?: { function: { name: string; description: string } }[] }) {
  const msgs = body.messages;
  const tools = (body.tools ?? []).map((t) => t.function);
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
  const lastUser = String(msgs[lastUserIdx]?.content ?? "");
  const toolResults = msgs.slice(lastUserIdx + 1).filter((m) => m.role === "tool");
  records.push({ tools: tools.map((t) => t.name), lastUser: lastUser.slice(0, 80), auth: false });
  const website = tools.filter((t) => t.name.startsWith("website_"));
  if (website.length) {
    // Partner side: call the website tool the request names, once, then answer with its result.
    const want = lastUser.includes("APPLY") ? "website_apply-docs-update" : "website_preview-docs-update";
    if (!toolResults.length) return { tool: { name: want, args: { version: "v1.0", summary: "Adds the plugin API." } } };
    return { text: `PARTNER_ANSWER: ${toolResults.at(-1)!.content}` };
  }
  const handoffs = tools.filter((t) => t.description.startsWith("Hand off to the"));
  if (handoffs[toolResults.length]) {
    return { tool: { name: handoffs[toolResults.length]!.name, args: { request: lastUser.includes("APPLY") ? "APPLY docs for v1.0" : "Preview docs for v1.0" } } };
  }
  if (!handoffs.length && toolResults.length === 0 && !lastUser.includes("APPLY")) return { text: `PEER_ANSWER from a network with tools [${tools.map((t) => t.name).join(",")}]` };
  return { text: `CALLER_FINAL: ${toolResults.map((m) => String(m.content).slice(0, 700)).join(" | ")}` };
}
const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { ...cors, "content-type": "text/event-stream" },
  });
let callSeq = 0;
Bun.serve({
  port: 4199,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET" } });
    if (url.pathname === "/records") return json(records);
    if (url.pathname === "/v1/models") return json({ data: [{ id: "mock-1" }] });
    if (url.pathname !== "/v1/chat/completions") return new Response("nope", { status: 404, headers: cors });
    const body = await req.json();
    const r = reply(body);
    records.at(-1)!.auth = req.headers.has("authorization");
    if ("tool" in r && r.tool) {
      return sse([
        { model: "mock-1", choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${++callSeq}`, type: "function", function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] } }] },
        { model: "mock-1", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]);
    }
    return sse([
      { model: "mock-1", choices: [{ delta: { content: r.text } }] },
      { model: "mock-1", choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
  },
});
console.log("spike up: host :4000/spike.html, pagewright :4101, chain :4111, router :4199");
