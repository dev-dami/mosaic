// MVP Profile 0.3 §6 check 4: "After user approval, load an exact named network from a second origin
// and run it locally in the caller's browser." Consent comes first: declined, nothing at all is sent
// to that origin. Allowed, the exact network loads from the second origin and its agent runs here, on
// the caller's router. A wrong name fails closed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ConsentRequest } from "../../src/host/agentic/engine";
import { BYOK_ROUTER, createAgent, FIX, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const world = new World().serveHost([]).serveFixtures();
world.routers.set(BYOK_ROUTER, (ask: ModelAsk): Reply => {
  if (ask.tools.includes("composer")) return ask.results === 0 && ask.tools.includes("extra_1") ? { call: "extra_1", args: { request: "Say hello" } } : { content: "Echo answered." };
  return { content: "Echo heard: Say hello" };
});
beforeAll(() => world.install());
afterAll(() => world.restore());

const setup = { key: KEY, router: BYOK_ROUTER, model: "m" };
const A = new URL(FIX.a).host;

describe("§6.4 consent first, then the exact named network from a second origin", () => {
  test("§6.4 declined: the connect fails visibly and no request reaches that origin at all", async () => {
    world.log.length = 0;
    const consents = { asked: [] as ConsentRequest[], answer: () => "decline" as const };
    const agent = await createAgent(setup, consents);
    await expect(agent.connectNetwork(`${FIX.a}/echo`)).rejects.toThrow(`You declined to connect ${A}. Nothing was sent to it.`);
    expect(consents.asked.map((r) => [r.kind, r.peerOrigin])).toEqual([["connect", A]]);
    expect(world.to(FIX.a)).toEqual([]);
    expect(agent.frontTools()).not.toContain("extra_1");
  });

  test("§6.4 allowed: the exact network loads from the second origin and runs in the caller, on the caller's router", async () => {
    world.log.length = 0;
    const consents = { asked: [] as ConsentRequest[], answer: () => "allow" as const };
    const agent = await createAgent(setup, consents);
    // Nothing goes to the second origin before the person agrees.
    expect(world.to(FIX.a)).toEqual([]);
    const bound = await agent.connectNetwork(`${FIX.a}/echo`);
    expect(consents.asked[0]).toMatchObject({ kind: "connect", peerOrigin: A });
    expect(bound).toMatchObject({ network: "echo", origin: FIX.a, slot: "extra_1" });
    // Only public files were read from the second origin: the manifest, the exact network, links.json.
    expect(world.to(FIX.a).map((r) => `${r.method} ${new URL(r.url).pathname}`).sort()).toEqual(["GET /agent-manifest.json", "GET /echo.network.json", "GET /links.json"]);

    const { turn, trace } = await runTurn(agent, "Say hello through echo");
    // The peer's own front agent ran in this runtime, on the caller's router.
    expect(trace.some((e) => e.phase === "start" && e.kind === "agent" && e.agent === "echo_assistant" && e.network === "echo")).toBe(true);
    const peerCall = world.modelCalls().find((c) => c.body.includes("Echo: says what it was asked."));
    expect(peerCall?.url).toBe(`${BYOK_ROUTER}/chat/completions`);
    expect(world.to(FIX.a).every((r) => r.method === "GET")).toBe(true);
    // Its answer came back through the caller's tool-result path.
    expect(turn.steps.find((s) => s.kind === "peer")).toMatchObject({ host: A, network: "echo", status: "ok", response: "Echo heard: Say hello" });
    expect(turn.answer).toBe("Echo answered.");
  });

  test("§6.4 a wrong name fails closed with the runtime's exact-name error and binds nothing", async () => {
    const agent = await createAgent(setup);
    await expect(agent.connectNetwork(`${FIX.a}/ech`)).rejects.toThrow(`No published network named 'ech' at ${A}; refusing to run a different network.`);
    expect(agent.frontTools()).not.toContain("extra_1");
    expect(agent.engine.runtimeAllowedPeers.has(FIX.a)).toBe(false);
  });
});
