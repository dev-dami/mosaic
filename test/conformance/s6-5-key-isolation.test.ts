// MVP Profile 0.3 §6 check 5: "When a user key is active, show that the second site never receives
// it and cannot change the caller's router." Every request to a site origin is logged; none carries
// the key, an Authorization header or a cookie, in its URL, headers or body. The peer's manifest
// publishes its own llm_router (providers/fixtures/), and it changes nothing: the peer runs on the
// caller's router.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BYOK_ROUTER, createAgent, FIX, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const world = new World().serveHost([{ slug: "cycle_a", origin: FIX.a }]).serveFixtures();
world.routers.set(BYOK_ROUTER, (ask: ModelAsk): Reply => {
  if (ask.tools.includes("composer")) return ask.results === 0 ? { call: "cycle_a", args: { request: "Pass this on" } } : { content: "Done." };
  if (ask.tools.includes("cycle_b") && ask.results === 0) return { call: "cycle_b", args: { request: "Pass this on" } };
  return { content: "Passed." };
});
beforeAll(() => world.install());
afterAll(() => world.restore());

describe("§6.5 the key stays with the caller's router", () => {
  test("§6.5 with a key active, no request to any site origin carries the key, Authorization or a cookie", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "m" });
    const { turn } = await runTurn(agent, "Pass a note through both fixture sites", { project: "Lumen" });
    expect(turn.steps.filter((s) => s.kind === "peer").map((s) => (s.kind === "peer" ? s.network : ""))).toEqual(["cycle_a", "cycle_b"]);
    const toSites = world.to(FIX.a, FIX.b);
    expect(toSites.length).toBeGreaterThanOrEqual(6); // two origins: manifest, network, links each
    for (const r of toSites) {
      expect([r.url, r.headers.authorization, r.headers.cookie]).toEqual([r.url, undefined, undefined]);
      expect(r.url + JSON.stringify(r.headers) + r.body).not.toContain(KEY);
    }
    // The key went to the selected router, and only there.
    const withKey = world.log.filter((r) => (r.url + JSON.stringify(r.headers) + r.body).includes(KEY));
    expect(withKey.length).toBeGreaterThan(0);
    expect(withKey.every((r) => r.url === `${BYOK_ROUTER}/chat/completions`)).toBe(true);
  });

  test("§6.5 a peer manifest that declares another llm_router does not change the caller's router", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "m" });
    const peerRouter = (world.docs.get(`${FIX.a}/agent-manifest.json`) as { llm_router: { base_url: string } }).llm_router.base_url;
    expect(peerRouter).not.toBe(BYOK_ROUTER);
    const { trace } = await runTurn(agent, "Pass a note through both fixture sites");
    const modelSpans = trace.filter((e) => e.phase === "start" && e.kind === "model_call");
    expect(modelSpans.length).toBeGreaterThanOrEqual(4); // mosaic, cycle_a, cycle_b, ...
    expect(new Set(modelSpans.map((e) => e.routerHost))).toEqual(new Set([new URL(BYOK_ROUTER).host]));
    expect(world.log.some((r) => r.url.startsWith(peerRouter))).toBe(false);
    expect((agent.engine as unknown as { userRouter: { baseUrl: string } }).userRouter.baseUrl).toBe(BYOK_ROUTER);
  });
});
