// Scout: Mosaic's agent for sites that publish no agent files. It opens a site in a headless
// browser, learns what its pages can do (with Claude when credentials are set, by rules otherwise),
// runs each learned read to check it, saves the result as an adapter template, and serves the
// adapter as a site on its own origin with the MVP profile 0.3 files: agent-manifest.json (with
// x_mosaic.agent), <slug>.network.json, links.json and the nsdeploy action bridge. Any caller's
// runtime connects that origin like any other site; every write is approved on Scout's own sheet.
//
// HTTP (callers must be a Mosaic host in MOSAIC_HOSTS; checked by the Origin header, which only
// browsers enforce, so the target rule below is what keeps a public Scout safe):
//   POST /learn      {url}        learn a site, save its template, serve it; returns the template summary
//   GET  /templates               saved templates
//   GET  /templates/:id           one adapter file (mosaic-adapter/0), for export
//   POST /templates  <adapter>    import an adapter file and serve it
//
// Targets: SCOUT_TARGETS lists the origins Scout may open (agent/targets.ts); without it, loopback
// only. Checked on /learn, on import, on load, and on every request the browser makes. Limits:
// request bodies up to 256 KB (413), one learn at a time (429), at most SCOUT_MAX_ADAPTERS served
// adapters (the oldest is unloaded). SCOUT_ADAPTER_ORIGIN (e.g. https://scout-{port}.example.com)
// gives each served adapter a public origin: {port} is its port, {n} its slot (port - base).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { serveSite } from "../providers/site";
import { CLAUDE_MODEL, hasClaudeCredentials, learnWithClaude } from "./learn-claude";
import { learnHeuristic } from "./learn-heuristic";
import { observe } from "./observe";
import { adapterSite, skillProblem, slug, verifySkills, type Adapter } from "./skill";
import { checkTarget, Refused, targetPolicy } from "./targets";

export const SCOUT_PORT = 4108;
export const MAX_BODY_BYTES = 256 * 1024;

export type ScoutConfig = {
  port: number;
  /** Scout's own public origin. */
  origin: string;
  /** Mosaic hosts allowed to call Scout (Origin header). */
  hosts: string[];
  dir: string;
  adapterBase: number;
  /** Template for a served adapter's origin; {port} and {n} are replaced. Unset: Scout's origin with the adapter's port. */
  adapterOrigin?: string;
  /** Comma list of allowed target origins (SCOUT_TARGETS). Unset: loopback only. */
  targets?: string;
  maxAdapters: number;
  learner: string;
  browser: () => Promise<Browser>;
};

function configFromEnv(): ScoutConfig {
  const port = Number(process.env.PORT ?? SCOUT_PORT);
  let browser: Promise<Browser> | null = null;
  return {
    port,
    origin: process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`,
    hosts: (process.env.MOSAIC_HOSTS ?? "http://localhost:4000").split(",").map((s) => s.trim()),
    dir: process.env.SCOUT_DIR ?? join(import.meta.dir, "..", ".scout"),
    adapterBase: Number(process.env.SCOUT_ADAPTER_PORT_BASE ?? port + 2),
    adapterOrigin: process.env.SCOUT_ADAPTER_ORIGIN || undefined,
    targets: process.env.SCOUT_TARGETS || undefined,
    maxAdapters: Number(process.env.SCOUT_MAX_ADAPTERS ?? 20),
    learner: process.env.SCOUT_LEARNER ?? (hasClaudeCredentials() ? "claude" : "rules"),
    // A crashed or killed Chromium is launched again on the next use instead of failing every call.
    browser: () =>
      (browser ??= chromium.launch({ executablePath: process.env.CHROMIUM_PATH }).then((b) => {
        b.on("disconnected", () => (browser = null));
        return b;
      }, (e) => {
        browser = null;
        throw e;
      })),
  };
}

const templateId = (target: string) => slug(new URL(target).host.replace(/[:.]/g, "-"), 60);

function isAdapter(x: unknown): x is Adapter {
  const a = x as Adapter;
  return !!a && a.mosaic === "adapter/0" && typeof a.target?.origin === "string" && /^https?:\/\/[^/]+$/.test(a.target.origin) && Array.isArray(a.skills) && a.skills.every((s) => !skillProblem(s));
}

/** The request body as JSON, refusing more than `max` bytes even when no content-length is sent. */
async function readJson(req: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  const tooLarge = () => new Refused(`request body over ${max / 1024} KB`, 413);
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    for await (const chunk of req.body) {
      size += chunk.byteLength;
      if (size > max) throw tooLarge();
      chunks.push(chunk);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Refused("send a JSON body", 400);
  }
}

type Served = { id: string; adapter: Adapter; port: number; origin: string; stop: () => void };

/** Start Scout's HTTP server. Templates saved in `dir` are served again, the newest kept at the cap. */
export function startScout(overrides: Partial<ScoutConfig> = {}) {
  const cfg = { ...configFromEnv(), ...overrides };
  const { learner } = cfg;
  const allowTarget = targetPolicy(cfg.targets);
  mkdirSync(cfg.dir, { recursive: true });

  // Insertion order is age: serving a template again moves it to the end.
  const served = new Map<string, Served>();
  let learning = false;

  const adapterOrigin = (p: number) =>
    cfg.adapterOrigin ? cfg.adapterOrigin.replaceAll("{port}", String(p)).replaceAll("{n}", String(p - cfg.adapterBase)) : `${cfg.origin.replace(/:\d+$/, "")}:${p}`;

  /**
   * Serve an adapter on a stable port: the one it had before, else the lowest free slot. At the cap
   * the oldest adapter is unloaded (its file stays), so ports stay within base .. base + max - 1.
   */
  function serve(adapter: Adapter): Served {
    const id = templateId(adapter.target.origin);
    const before = served.get(id);
    before?.stop();
    served.delete(id);
    while (served.size >= cfg.maxAdapters) {
      const [oldest] = served.values();
      oldest!.stop();
      served.delete(oldest!.id);
      console.log(`Scout unloaded ${oldest!.adapter.target.origin} (cap ${cfg.maxAdapters})`);
    }
    const used = new Set([...served.values()].map((s) => s.port));
    let p = before?.port ?? cfg.adapterBase;
    while (!before && used.has(p)) p++;
    const at = adapterOrigin(p);
    const server = serveSite(adapterSite(adapter, cfg.browser), { port: p, origin: at });
    const s: Served = { id, adapter, port: p, origin: at, stop: () => server.stop(true) };
    served.set(id, s);
    return s;
  }

  function save(adapter: Adapter) {
    writeFileSync(join(cfg.dir, `${templateId(adapter.target.origin)}.json`), JSON.stringify(adapter, null, 2));
  }

  async function learn(url: string): Promise<Adapter> {
    const target = checkTarget(allowTarget, url);
    const browser = await cfg.browser();
    const obs = await observe(browser, target.href);
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
    const verified = await verifySkills(browser, obs.origin, skills);
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

  // Load saved templates oldest first, so the newest survive the cap. A target no longer allowed stays on disk, unserved.
  const saved: Adapter[] = [];
  for (const file of readdirSync(cfg.dir).filter((f) => f.endsWith(".json"))) {
    try {
      const adapter = JSON.parse(readFileSync(join(cfg.dir, file), "utf8"));
      if (!isAdapter(adapter)) continue;
      const why = allowTarget(adapter.target.origin);
      if (why) console.log(`Scout skipped ${file}: ${why}`);
      else saved.push(adapter);
    } catch (e) {
      console.log(`Scout skipped ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const adapter of saved.sort((a, b) => String(a.learned?.at).localeCompare(String(b.learned?.at)))) serve(adapter);

  /** Only a Mosaic host this Scout trusts may use it. Browsers send Origin on every cross-origin call. */
  function cors(req: Request): Record<string, string> | null {
    const from = req.headers.get("origin");
    if (!from || !cfg.hosts.includes(from)) return null;
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
        const status = e instanceof Refused ? e.status : 422;
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status, headers });
      }
    };
  }

  const home = () =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>Scout</title><style>body{font:14px/1.5 ui-monospace,monospace;max-width:760px;margin:40px auto;padding:0 16px}</style>
<h1>Scout</h1><p>Mosaic's agent for sites that publish no manifest. Learner: ${learner === "claude" ? CLAUDE_MODEL : "rules (set ANTHROPIC_API_KEY to learn with Claude)"}.</p>
<h2>Templates</h2><ul>${[...served.values()].map((s) => `<li>${Bun.escapeHTML(s.adapter.target.name)}: drives ${Bun.escapeHTML(s.adapter.target.origin)}, served on ${Bun.escapeHTML(s.origin)}, ${s.adapter.skills.length} skills</li>`).join("") || "<li>None yet</li>"}</ul>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  const server = Bun.serve({
    port: cfg.port,
    // Backstop for readJson's own limit; past this Bun answers 413 itself.
    maxRequestBodySize: MAX_BODY_BYTES * 2,
    routes: {
      "/": home,
      "/learn": {
        OPTIONS: guarded(() => new Response(null)),
        POST: guarded(async (req, headers) => {
          if (learning) return Response.json({ error: "Scout learns one site at a time; try again when the current learn ends" }, { status: 429, headers: { ...headers, "retry-after": "10" } });
          learning = true;
          try {
            const { url } = ((await readJson(req)) ?? {}) as { url?: unknown };
            if (typeof url !== "string" || !url) return Response.json({ error: "send {url}" }, { status: 400, headers });
            const adapter = await learn(url);
            save(adapter);
            return Response.json(summary(serve(adapter)), { headers });
          } finally {
            learning = false;
          }
        }),
      },
      "/templates": {
        OPTIONS: guarded(() => new Response(null)),
        GET: guarded((_req, headers) => Response.json([...served.values()].map(summary), { headers })),
        POST: guarded(async (req, headers) => {
          const adapter = await readJson(req);
          if (!isAdapter(adapter)) return Response.json({ error: "not a valid mosaic-adapter/0 file" }, { status: 400, headers });
          checkTarget(allowTarget, adapter.target.origin);
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
  const rule = cfg.targets ? `targets: ${cfg.targets}` : "targets: loopback only (set SCOUT_TARGETS)";
  console.log(`Scout on ${cfg.origin} (learner: ${learner === "claude" ? CLAUDE_MODEL : "rules"}, ${rule}, templates in ${cfg.dir})`);
  return {
    url: `http://localhost:${server.port}`,
    stop() {
      for (const s of served.values()) s.stop();
      served.clear();
      void server.stop(true);
    },
  };
}

if (import.meta.main) startScout();
