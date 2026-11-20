import { afterAll, describe, expect, test } from "bun:test";
import { registerSiteActions, type ActionDeps } from "../providers/bridge-actions";
import { agentsSite } from "../providers/agents";
import { announcerSite } from "../providers/announcer";
import { docsSite } from "../providers/docs";
import { issuesSite } from "../providers/issues";
import { newsletterSite } from "../providers/newsletter";
import { releasesSite } from "../providers/releases";
import { createSite, serveSite, type BridgeConfig, type SiteDefinition } from "../providers/site";
import { videosSite } from "../providers/videos";
// @ts-expect-error The vendored runtime ships no type declarations.
import { ActionRegistry } from "../vendor/nsdeploy-runtime/actions.js";

const HOST = "http://localhost:4000";
const sites: SiteDefinition[] = [docsSite, releasesSite, announcerSite, newsletterSite, videosSite, issuesSite, agentsSite];
const scope = { base: "http://localhost:4101/bridge", network: "site" };

type Entry = { name: string; effect: string; availability: string; callerOrigins: string[]; confirmsInWindow: boolean; outputSchema?: unknown; execute: (args: unknown, ctx?: unknown) => Promise<unknown> };

function register(config: BridgeConfig, deps: ActionDeps): Map<string, Entry> {
  const registry = new ActionRegistry();
  registerSiteActions({ register: (d: unknown) => registry.register(scope, d) }, config, deps);
  return new Map([...(registry.entries.values() as Iterable<Entry>)].map((e) => [e.name, e]));
}

const noDeps: ActionDeps = {
  post: async () => ({ ok: true, body: {} }),
  ask: async () => true,
  status: () => {},
};

describe("bridge actions: every demo site registers with the vendored runtime", () => {
  for (const def of sites) {
    test(`${def.name}: one action per capability, writes irreversible and confirmed in the site's window`, () => {
      const { bridgeConfig } = createSite(def, "http://localhost:4101", [HOST]);
      const entries = register(bridgeConfig, noDeps);
      expect([...entries.keys()]).toEqual(def.capabilities.map((c) => c.id));
      for (const cap of def.capabilities) {
        const e = entries.get(cap.id)!;
        expect(e.availability).toBe("bridge");
        expect(e.callerOrigins).toEqual([HOST]);
        expect(e.effect).toBe(cap.side_effects === "read" ? "read" : "irreversible");
        expect(e.confirmsInWindow).toBe(cap.side_effects === "write");
        expect(e.outputSchema).toBeDefined();
      }
    });
  }
});

describe("bridge actions: execute", () => {
  const { bridgeConfig } = createSite(announcerSite, "http://localhost:4103", [HOST]);

  test("a read posts to the site's API and returns its output", async () => {
    const posts: [string, unknown][] = [];
    const entries = register(bridgeConfig, { ...noDeps, post: async (id, args) => (posts.push([id, args]), { ok: true, body: { text: "hi" } }) });
    const args = { project: "acme", version: "v1", notes: "x" };
    expect(await entries.get("draft-announcement")!.execute(args)).toEqual({ text: "hi" });
    expect(posts).toEqual([["draft-announcement", args]]);
  });

  test("a read the site refuses throws the site's error", async () => {
    const entries = register(bridgeConfig, { ...noDeps, post: async () => ({ ok: false, body: { error: "bad notes" } }) });
    await expect(entries.get("draft-announcement")!.execute({ project: "a", version: "v1", notes: "x" })).rejects.toThrow("bad notes");
  });

  test("Deny on the site's sheet returns ok:false denied and sends nothing", async () => {
    let posted = false;
    let asked: unknown[] = [];
    const entries = register(bridgeConfig, {
      ...noDeps,
      ask: async (...a) => ((asked = a), false),
      post: async () => ((posted = true), { ok: true, body: {} }),
    });
    const result = await entries.get("schedule-announcement")!.execute({ text: "Hello" }, { callerOrigin: HOST });
    expect(result).toEqual({ ok: false, reason: "denied" });
    expect(posted).toBe(false);
    expect((asked[0] as { id: string }).id).toBe("schedule-announcement");
    expect(asked[2]).toBe(HOST);
  });

  test("Approve runs the write, shows the site's status and returns ok:true with the output", async () => {
    const shown: string[] = [];
    const entries = register(bridgeConfig, {
      ask: async () => true,
      post: async () => ({ ok: true, body: { id: "post-1", posts_at: "2026-12-01T09:00:00.000Z", url: "/posts/post-1" } }),
      status: (kind) => void shown.push(kind),
    });
    const result = await entries.get("schedule-announcement")!.execute({ text: "Hello" }, { callerOrigin: HOST });
    expect(result).toEqual({ ok: true, id: "post-1", posts_at: "2026-12-01T09:00:00.000Z", url: "/posts/post-1" });
    expect(shown).toEqual(["working", "done"]);
  });

  test("an approved write the site refuses returns ok:false with the site's reason", async () => {
    const shown: string[] = [];
    const entries = register(bridgeConfig, { ask: async () => true, post: async () => ({ ok: false, body: { error: "Post at is not a date" } }), status: (k) => void shown.push(k) });
    expect(await entries.get("schedule-announcement")!.execute({ text: "Hello", post_at: "soon" }, { callerOrigin: HOST })).toEqual({ ok: false, reason: "Post at is not a date" });
    expect(shown).toEqual(["working", "failed"]);
  });
});

describe("site API errors", () => {
  test("a capability that throws gives a JSON error, not a crash (bad date to Loudhailer)", async () => {
    const origin = "http://localhost:4103";
    const site = createSite(announcerSite, origin, [HOST]);
    const res = await site.handleApi(
      new Request(`${origin}/api/capabilities/schedule-announcement`, { method: "POST", headers: { origin }, body: JSON.stringify({ text: "Hi", post_at: "next tuesday-ish" }) }),
      "schedule-announcement",
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe("string");
    expect(site.activity).toHaveLength(0);
  });

  test("the two ISO 8601 fields carry the datetime widget hint", () => {
    expect(announcerSite.capabilities[1]!.input_schema.properties!.post_at!["x-mosaic-widget"]).toBe("datetime");
    expect(newsletterSite.capabilities[1]!.input_schema.properties!.send_at!["x-mosaic-widget"]).toBe("datetime");
  });
});

describe("served bridge files", () => {
  const port = 6591;
  const prev = process.env.MOSAIC_HOSTS;
  process.env.MOSAIC_HOSTS = HOST;
  const server = serveSite(docsSite, { port });
  if (prev === undefined) delete process.env.MOSAIC_HOSTS;
  else process.env.MOSAIC_HOSTS = prev;
  afterAll(() => server.stop(true));
  const base = `http://localhost:${port}`;

  test("the action bridge page loads the runtime's bridge, may be framed only by Mosaic hosts, and sets no COOP", async () => {
    const res = await fetch(`${base}/bridge/action-bridge.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toBe(`frame-ancestors ${HOST}`);
    expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(await res.text()).toContain('<script type="module" src="../runtime/action-bridge.js"></script>');
  });

  test("the action module is JavaScript that exports registerActions", async () => {
    const res = await fetch(`${base}/bridge/bridge-actions.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toMatch(/export\s*\{[^}]*registerActions/);
  });

  test("the bridge config lists the callers and each capability's schemas", async () => {
    const config = (await (await fetch(`${base}/bridge/bridge-config.json`)).json()) as BridgeConfig;
    expect(config.allowed_hosts).toEqual([HOST]);
    expect(config.capabilities.map((c) => c.id)).toEqual(docsSite.capabilities.map((c) => c.id));
    expect(config.capabilities[0]!.input_schema).toEqual(docsSite.capabilities[0]!.input_schema);
  });

  test("the old bridge/0 routes still answer until C7", async () => {
    expect((await fetch(`${base}/.well-known/mosaic-capabilities.json`)).status).toBe(200);
    expect((await fetch(`${base}/mosaic/bridge-config`)).status).toBe(200);
  });
});
