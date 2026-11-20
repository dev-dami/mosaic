// Scout: Mosaic's agent for sites that publish no manifest. It opens a site in a headless browser,
// learns what its pages can do (with Claude when credentials are set, by rules otherwise), runs each
// learned read to check it, saves the result as an adapter template, and serves the adapter as an
// ordinary Mosaic site on its own origin. Mosaic connects that origin like any other site; the
// manifest says an agent runs it, and every write is approved on Scout's own sheet.
//
// HTTP (callers must be a Mosaic host in MOSAIC_HOSTS; checked by the Origin header):
//   POST /learn      {url}        learn a site, save its template, serve it; returns the template summary
//   GET  /templates               saved templates
//   GET  /templates/:id           one adapter file (mosaic-adapter/0), for export
//   POST /templates  <adapter>    import an adapter file and serve it
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { serveSite, type SiteDefinition } from "../providers/site";
import { CLAUDE_MODEL, hasClaudeCredentials, learnWithClaude } from "./learn-claude";
import { learnHeuristic } from "./learn-heuristic";
import { observe } from "./observe";
import { runSkill, skillProblem, slug, toCapability, type Adapter, type Skill } from "./skill";

export const SCOUT_PORT = 4108;
const port = Number(process.env.PORT ?? SCOUT_PORT);
const origin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
const allowedHosts = (process.env.MOSAIC_HOSTS ?? "http://localhost:4000").split(",").map((s) => s.trim());
const dir = process.env.SCOUT_DIR ?? join(import.meta.dir, "..", ".scout");
const adapterBase = Number(process.env.SCOUT_ADAPTER_PORT_BASE ?? port + 2);
const learner = process.env.SCOUT_LEARNER ?? (hasClaudeCredentials() ? "claude" : "rules");
mkdirSync(dir, { recursive: true });

let browser: Promise<Browser> | null = null;
const getBrowser = () => (browser ??= chromium.launch({ executablePath: process.env.CHROMIUM_PATH }));

type Served = { id: string; adapter: Adapter; port: number; origin: string; stop: () => void };
const served = new Map<string, Served>();

const templateId = (target: string) => slug(new URL(target).host.replace(/[:.]/g, "-"), 60);

function siteFor(adapter: Adapter, browserFor: () => Promise<Browser>): SiteDefinition {
  const host = new URL(adapter.target.origin).host;
  return {
    name: adapter.target.name,
    description: `Learned by Scout from ${host}. ${host} did not publish these; Scout performs them in a browser.`,
    port: 0,
    look: { scheme: "light", accent: adapter.target.theme_color ?? "#5b6472", font: "mono" },
    agent: { name: "Scout", drives: adapter.target.origin, learned_by: adapter.learned.by },
    capabilities: adapter.skills.map((skill) => ({ ...toCapability(skill), run: async (input: unknown) => runSkill(await browserFor(), adapter.target.origin, skill, input) })),
  };
}

/** Serve an adapter on a stable port: the one it had before, else the next free one. */
function serve(adapter: Adapter): Served {
  const id = templateId(adapter.target.origin);
  const before = served.get(id);
  before?.stop();
  const used = new Set([...served.values()].map((s) => s.port));
  let p = before?.port ?? adapterBase;
  while (!before && used.has(p)) p++;
  const at = `${origin.replace(/:\d+$/, "")}:${p}`;
  const server = serveSite(siteFor(adapter, getBrowser), { port: p, origin: at });
  const s: Served = { id, adapter, port: p, origin: at, stop: () => server.stop(true) };
  served.set(id, s);
  return s;
}

function save(adapter: Adapter) {
  writeFileSync(join(dir, `${templateId(adapter.target.origin)}.json`), JSON.stringify(adapter, null, 2));
}

function isAdapter(x: unknown): x is Adapter {
  const a = x as Adapter;
  return !!a && a.mosaic === "adapter/0" && typeof a.target?.origin === "string" && /^https?:\/\/[^/]+$/.test(a.target.origin) && Array.isArray(a.skills) && a.skills.every((s) => !skillProblem(s));
}

/** Run each read that can run with what Scout saw. A read that fails is dropped; writes are never run here. */
async function verify(target: string, skills: Skill[]): Promise<Skill[]> {
  const b = await getBrowser();
  const kept: Skill[] = [];
  for (const skill of skills) {
    if (skillProblem(skill)) continue;
    if (skill.side_effects === "write") {
      kept.push({ ...skill, verified: false });
      continue;
    }
    const input = Object.fromEntries(skill.fields.map((f) => [f.name, f.example]));
    if (skill.fields.some((f) => f.required && !f.example)) {
      kept.push({ ...skill, verified: false });
      continue;
    }
    try {
      await runSkill(b, target, skill, input);
      kept.push({ ...skill, verified: true });
    } catch (e) {
      console.log(`Scout dropped "${skill.title}": ${e instanceof Error ? e.message : e}`);
    }
  }
  return kept;
}

async function learn(url: string): Promise<Adapter> {
  const target = new URL(url);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Scout learns http and https sites only");
  // shortcut: any http(s) target is allowed, also private addresses (the demo sites are on localhost).
  // Before Scout runs on a shared server, restrict targets with an allow list.
  const obs = await observe(await getBrowser(), target.href);
  const draft = learnHeuristic(obs);
  let skills = draft;
  let by = "rules";
  if (learner === "claude") {
    try {
      skills = await learnWithClaude(obs, draft);
      by = CLAUDE_MODEL;
    } catch (e) {
      console.log(`Scout fell back to rules: ${e instanceof Error ? e.message : e}`);
    }
  }
  const verified = await verify(obs.origin, skills);
  if (!verified.length) throw new Error(`Scout found nothing it could do on ${target.host}`);
  return { mosaic: "adapter/0", target: { origin: obs.origin, name: obs.name, theme_color: obs.themeColor }, learned: { by, at: new Date().toISOString() }, skills: verified };
}

const summary = (s: Served) => ({
  id: s.id,
  name: s.adapter.target.name,
  target: s.adapter.target.origin,
  origin: s.origin,
  learned_by: s.adapter.learned.by,
  learned_at: s.adapter.learned.at,
  skills: s.adapter.skills.map((k) => ({ title: k.title, side_effects: k.side_effects, verified: !!k.verified })),
});

// Load saved templates.
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  try {
    const adapter = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (isAdapter(adapter)) serve(adapter);
  } catch (e) {
    console.log(`Scout skipped ${file}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Only a Mosaic host this Scout trusts may use it. Browsers send Origin on every cross-origin call. */
function cors(req: Request): Record<string, string> | null {
  const from = req.headers.get("origin");
  if (!from || !allowedHosts.includes(from)) return null;
  return { "access-control-allow-origin": from, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST", vary: "origin" };
}

function guarded(handler: (req: Request, headers: Record<string, string>) => Promise<Response> | Response) {
  return async (req: Request) => {
    const headers = cors(req);
    if (!headers) return Response.json({ error: "Scout accepts requests only from its Mosaic hosts" }, { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      return await handler(req, headers);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422, headers });
    }
  };
}

const home = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Scout</title><style>body{font:14px/1.5 ui-monospace,monospace;max-width:760px;margin:40px auto;padding:0 16px}</style>
<h1>Scout</h1><p>Mosaic's agent for sites that publish no manifest. Learner: ${learner === "claude" ? CLAUDE_MODEL : "rules (set ANTHROPIC_API_KEY to learn with Claude)"}.</p>
<h2>Templates</h2><ul>${[...served.values()].map((s) => `<li>${Bun.escapeHTML(s.adapter.target.name)}: drives ${Bun.escapeHTML(s.adapter.target.origin)}, served on ${s.origin}, ${s.adapter.skills.length} skills</li>`).join("") || "<li>None yet</li>"}</ul>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

Bun.serve({
  port,
  routes: {
    "/": home,
    "/learn": {
      OPTIONS: guarded(() => new Response(null)),
      POST: guarded(async (req, headers) => {
        const { url } = (await req.json()) as { url?: string };
        if (!url) return Response.json({ error: "send {url}" }, { status: 400, headers });
        const adapter = await learn(url);
        save(adapter);
        return Response.json(summary(serve(adapter)), { headers });
      }),
    },
    "/templates": {
      OPTIONS: guarded(() => new Response(null)),
      GET: guarded((_req, headers) => Response.json([...served.values()].map(summary), { headers })),
      POST: guarded(async (req, headers) => {
        const adapter = await req.json();
        if (!isAdapter(adapter)) return Response.json({ error: "not a valid mosaic-adapter/0 file" }, { status: 400, headers });
        save(adapter);
        return Response.json(summary(serve(adapter)), { headers });
      }),
    },
    "/templates/:id": guarded((req, headers) => {
      const s = served.get(new URL(req.url).pathname.split("/").pop() ?? "");
      if (!s) return Response.json({ error: "no such template" }, { status: 404, headers });
      return Response.json(s.adapter, { headers: { ...headers, "content-disposition": `attachment; filename="${s.id}.mosaic-adapter.json"` } });
    }),
  },
});
console.log(`Scout on ${origin} (learner: ${learner === "claude" ? CLAUDE_MODEL : "rules"}, templates in ${dir})`);
