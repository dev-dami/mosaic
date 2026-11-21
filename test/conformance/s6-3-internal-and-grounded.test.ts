// MVP Profile 0.3 §6 check 3: "Call an internal agent and at least one grounded capability through
// MCP or a registered local site action." Mosaic's front agent calls its internal agent composer,
// then Pagewright's network, whose agent calls the grounded website_preview-docs-update: a site
// action Pagewright's own action module (providers/bridge-actions.ts) registers in the caller's
// runtime registry and runs against Pagewright's own API. Headless, the module registers in process
// instead of through the bridge window; e2e/agent.e2e.cjs runs the same turn through the real bridge.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { registerSiteActions } from "../../providers/bridge-actions";
import { AGENT_MANIFEST_PATH, LINKS_PATH, networkPath } from "../../providers/agentic";
import { docsSite } from "../../providers/docs";
import { createSite } from "../../providers/site";
import type { MosaicAgent } from "../../src/host/agentic/engine";
import { BYOK_ROUTER, createAgent, HOST, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const PAGEWRIGHT = "http://pagewright.test";
const DRAFT = "Lumen v1.0 adds a plugin API.";
const site = createSite(docsSite, PAGEWRIGHT, [HOST]);
const world = new World()
  .serveHost([{ slug: "pagewright", origin: PAGEWRIGHT }])
  .serve(PAGEWRIGHT, { [AGENT_MANIFEST_PATH]: site.agentic.agentManifest, [networkPath(docsSite)]: site.agentic.network, [LINKS_PATH]: site.agentic.links });
world.routers.set(BYOK_ROUTER, (ask: ModelAsk): Reply => {
  if (ask.tools.includes("composer")) {
    return [
      { call: "composer", args: { request: "Draft one line of release notes for Lumen v1.0" } },
      { call: "pagewright", args: { request: `Preview the docs update for v1.0: ${DRAFT}` } },
      { content: "Notes drafted and docs previewed." },
    ][ask.results] as Reply;
  }
  if (ask.tools.includes("website_preview-docs-update")) {
    return ask.results === 0 ? { call: "website_preview-docs-update", args: { version: "v1.0", summary: DRAFT } } : { content: "The docs preview is ready." };
  }
  return { content: DRAFT }; // composer
});
beforeAll(() => world.install());
afterAll(() => world.restore());

/** Pagewright's action module registers its actions for this caller, as its bridge does. */
function registerPagewright(agent: MosaicAgent, apiCalls: { id: string; origin: string | null }[]) {
  const scope = { base: PAGEWRIGHT, network: site.agentic.agentManifest.networks[0]!.name };
  const registry = agent.engine.actions as unknown as { register(scope: object, def: object): string; remoteLoads?: Map<string, Promise<void>> };
  registry.remoteLoads ??= new Map();
  registry.remoteLoads.set(`${scope.base}::${scope.network}`, Promise.resolve());
  registerSiteActions({ register: (def) => registry.register(scope, def) }, site.bridgeConfig, {
    // The bridge page runs on Pagewright's origin, so its API calls carry that Origin.
    post: async (id, args) => {
      const req = new Request(`${PAGEWRIGHT}/api/capabilities/${id}`, { method: "POST", headers: { origin: PAGEWRIGHT, "content-type": "application/json" }, body: JSON.stringify(args) });
      apiCalls.push({ id, origin: req.headers.get("origin") });
      const res = await site.handleApi(req, id);
      return { ok: res.ok, body: await res.json() };
    },
    ask: async () => false,
    status: () => {},
  });
}

describe("§6.3 internal agent and a grounded site action", () => {
  test("§6.3 the front agent calls composer and a grounded website_ action through Pagewright's registered action; the output returns", async () => {
    const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "m" });
    const apiCalls: { id: string; origin: string | null }[] = [];
    registerPagewright(agent, apiCalls);
    const { turn } = await runTurn(agent, "Draft notes for Lumen v1.0 and preview the docs");
    expect(turn.status).toBe("done");
    const [composer, peer] = turn.steps;
    expect(composer).toMatchObject({ kind: "composer", status: "ok", draft: DRAFT });
    expect(peer).toMatchObject({ kind: "peer", network: "pagewright", host: "pagewright.test", status: "ok", response: "The docs preview is ready." });
    if (peer?.kind !== "peer") throw new Error("no peer step");
    expect(peer.cards).toHaveLength(1);
    expect(peer.cards[0]).toMatchObject({ action: "preview-docs-update", input: { version: "v1.0", summary: DRAFT }, status: "ok" });
    // The grounded output is the site's own answer: its receipt carries Pagewright's proposed page.
    expect(peer.cards[0]!.preview).toContain('"status":"succeeded"');
    expect(peer.cards[0]!.preview).toContain("docs/getting-started.md");
    expect(apiCalls).toEqual([{ id: "preview-docs-update", origin: PAGEWRIGHT }]);
    expect(turn.answer).toBe("Notes drafted and docs previewed.");
  });
});
