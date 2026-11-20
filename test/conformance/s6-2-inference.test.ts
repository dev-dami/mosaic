// MVP Profile 0.3 §6 check 2: "Load and run that network in a browser with the site's published
// default router and model; if BYOK is offered, also demonstrate the user-selected path." The host
// manifest here publishes a local router in llm_router, so the check can see where requests go.
// Mosaic's owner decision: with no key there is no model call at all (manual mode), so the host
// never pays; Otari, the router Mosaic publishes live, needs the visitor's key.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NO_KEY_MESSAGE } from "../../src/host/agentic/engine";
import { DEFAULT_MODEL } from "../../src/host/agentic/network";
import { BYOK_ROUTER, createAgent, FIX, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const PUBLISHED_ROUTER = "http://published-router.test/v1";
const world = new World()
  .serveHost([{ slug: "echo", origin: FIX.a }], ({ agentManifest }) => {
    agentManifest.llm_router = { base_url: PUBLISHED_ROUTER, mock: false, byok_router: PUBLISHED_ROUTER };
  })
  .serveFixtures();
const script = (ask: ModelAsk): Reply => {
  if (ask.tools.includes("composer")) return ask.results === 0 ? { call: "echo", args: { request: "Say hello" } } : { content: "Echo said hello." };
  return { content: "Hello." };
};
world.routers.set(PUBLISHED_ROUTER, script).set(BYOK_ROUTER, script);

beforeAll(() => world.install());
afterAll(() => world.restore());

const hostOf = (url: string) => new URL(url).host;

describe("§6.2 published default router, BYOK router, and no key", () => {
  test("§6.2 with no router in the profile, every model call goes to the manifest's published llm_router", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: KEY, router: "", model: "" });
    const { turn } = await runTurn(agent, "Say hello through echo");
    expect(turn.status).toBe("done");
    const calls = world.modelCalls();
    expect(calls.length).toBeGreaterThanOrEqual(3); // mosaic, echo (run in this browser), mosaic again
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set([`${PUBLISHED_ROUTER}/chat/completions`]));
    expect(calls.every((c) => JSON.parse(c.body).model === DEFAULT_MODEL)).toBe(true);
    // The runbook names the router it used (spec §5 observable execution).
    expect(turn.model).toEqual({ name: DEFAULT_MODEL, routerHost: hostOf(PUBLISHED_ROUTER) });
  });

  test("§6.2 a BYOK profile sends every model call to the selected router with Authorization", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "byok-model" });
    const { turn } = await runTurn(agent, "Say hello through echo");
    expect(turn.status).toBe("done");
    const calls = world.modelCalls();
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.url === `${BYOK_ROUTER}/chat/completions` && c.headers.authorization === `Bearer ${KEY}`)).toBe(true);
    expect(calls.every((c) => JSON.parse(c.body).model === "byok-model")).toBe(true);
    expect(turn.model).toEqual({ name: "byok-model", routerHost: hostOf(BYOK_ROUTER) });
  });

  test("§6.2 no key: manual mode, and not one model request is made (the host never pays)", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: "", router: "", model: "" });
    expect(agent.mode).toBe("manual");
    expect(() => agent.runTurn("Say hello through echo")).toThrow(NO_KEY_MESSAGE);
    await agent.connectNetwork(`${FIX.a}/fan_1`, { consented: true });
    expect(() => agent.runTurn("Say hello through fan_1")).toThrow(NO_KEY_MESSAGE);
    expect(world.modelCalls()).toEqual([]);
  });
});
