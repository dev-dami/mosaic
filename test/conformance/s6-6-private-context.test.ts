// MVP Profile 0.3 §6 check 6: "Show that private context is absent at the peer unless a named field
// is explicitly allowed." Mosaic's front agent allows project and version downstream
// (allow.to_downstream.sly_data). The peer here records the private context its run receives (the
// context the runtime builds for it, engine.js Session.invoke), and the check compares.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MosaicAgent } from "../../src/host/agentic/engine";
import { BYOK_ROUTER, createAgent, FIX, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const PRIVATE = { project: "Lumen", version: "v1.0", secret: "s3cret-value-77" };
const world = new World().serveHost([{ slug: "echo", origin: FIX.a }]).serveFixtures();
world.routers.set(BYOK_ROUTER, (ask: ModelAsk): Reply => {
  if (ask.tools.includes("composer")) return ask.results === 0 ? { call: "echo", args: { request: "What do you know?" } } : { content: "Done." };
  return { content: "Echo answered." };
});
beforeAll(() => world.install());
afterAll(() => world.restore());

/** What each peer run received as private context: the scripted peer's echo. */
function recordPeerContext(agent: MosaicAgent) {
  const received: Record<string, unknown>[] = [];
  const engine = agent.engine as unknown as { _makeCtx(args: { isTop?: boolean; slyData?: Record<string, unknown> }): unknown };
  const make = engine._makeCtx.bind(engine);
  engine._makeCtx = (args) => {
    if (!args.isTop) received.push({ ...args.slyData });
    return make(args);
  };
  return received;
}

describe("§6.6 private context crosses only by name", () => {
  test("§6.6 slyData {project, version, secret} reaches the peer as {project, version} only", async () => {
    world.log.length = 0;
    const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "m" });
    const received = recordPeerContext(agent);
    const { trace } = await runTurn(agent, "Ask echo", PRIVATE);
    expect(received).toEqual([{ project: "Lumen", version: "v1.0" }]);
    // The trace shows only the keys that crossed, never their values.
    const call = trace.find((e) => e.phase === "start" && e.kind === "remote_call");
    expect((call?.requestPayload as { sly_data: unknown }).sly_data).toEqual({ project: "<redacted>", version: "<redacted>" });
    // The secret is in no request at all: not to the site, not to the router.
    expect(world.log.some((r) => (r.url + JSON.stringify(r.headers) + r.body).includes(PRIVATE.secret))).toBe(false);
  });

  test("§6.6 a network that allows no field sends the peer no private context", async () => {
    const strict = new World().serveHost([{ slug: "echo", origin: FIX.a }], ({ network }) => {
      delete (network.tools[0] as { allow?: unknown }).allow;
    }).serveFixtures();
    strict.routers.set(BYOK_ROUTER, world.routers.get(BYOK_ROUTER)!);
    world.restore();
    strict.install();
    try {
      const agent = await createAgent({ key: KEY, router: BYOK_ROUTER, model: "m" });
      const received = recordPeerContext(agent);
      await runTurn(agent, "Ask echo", PRIVATE);
      expect(received).toEqual([{}]);
    } finally {
      strict.restore();
      world.install();
    }
  });
});
