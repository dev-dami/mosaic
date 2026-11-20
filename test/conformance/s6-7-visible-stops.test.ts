// MVP Profile 0.3 §6 check 7: "Stop an invalid network, a composition cycle, an over-budget
// request, and a denied origin with visible errors." Each stop runs in a real turn of Mosaic's agent
// on the vendored runtime against the fixture networks (providers/fixtures/), and must produce both
// the runtime's own error and the problem row Mosaic's runbook shows (src/host/agentic/turn.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DENIED_NETWORK, FAN_OUT, GHOST_AGENT } from "../../providers/fixtures";
import { MAX_REMOTE_CALLS } from "../../src/host/agentic/engine";
import { BYOK_ROUTER, createAgent, FIX, KEY, runTurn, World, type ModelAsk, type Reply } from "./world";

const host = (origin: string) => new URL(origin).host;
const slots = ["broken", "cycle_a", "stray", "echo", ...FAN_OUT];
const world = new World().serveHost(slots.map((slug) => ({ slug, origin: FIX.a }))).serveFixtures();

/** Mosaic's front agent calls what the outcome names; each fixture agent does what its network says. */
function script(ask: ModelAsk): Reply {
  if (ask.tools.includes("composer")) {
    const want = (name: string) => (ask.results === 0 ? { call: name, args: { request: ask.user } } : { content: "Done." });
    if (/invalid/.test(ask.user)) return want("broken");
    if (/cycle/.test(ask.user)) return want("cycle_a");
    if (/denied/.test(ask.user)) return want("stray");
    if (/decline/.test(ask.user)) return want("echo");
    if (/budget/.test(ask.user)) return ask.results < FAN_OUT.length ? { call: FAN_OUT[ask.results]!, args: { request: ask.user } } : { content: "Done." };
    return { content: "Nothing to do." };
  }
  const own = ask.tools.find((t) => t === "cycle_b" || t === "cycle_a" || t === DENIED_NETWORK);
  if (own && ask.results === 0) return { call: own, args: { request: ask.user } };
  return { content: "Answered." };
}
world.routers.set(BYOK_ROUTER, script);

beforeAll(() => world.install());
afterAll(() => world.restore());

const setup = { key: KEY, router: BYOK_ROUTER, model: "mock-model" };

describe("§6.7 visible stops: invalid network, cycle, over budget, denied origin", () => {
  test("§6.7 an invalid network stops with the runtime's validation error and a problem row", async () => {
    const agent = await createAgent(setup);
    const { problems, trace } = await runTurn(agent, "Use the invalid network");
    const error = `Network 'broken' (${host(FIX.a)}) failed validation: Agent 'broken_assistant' references missing tool '${GHOST_AGENT}'.`;
    expect(trace.some((e) => e.phase === "end" && e.kind === "remote_fetch" && e.status === "error" && e.error === error)).toBe(true);
    expect(problems).toEqual([["broken", error]]);
    // Connecting it by URL refuses it the same way, and binds nothing.
    agent.disconnectNetwork(`${FIX.a}/broken`);
    await expect(agent.connectNetwork(`${FIX.a}/broken`, { consented: true })).rejects.toThrow(error);
    expect(agent.frontTools()).not.toContain("broken");
  });

  test("§6.7 a composition cycle cycle_a ↔ cycle_b stops with the runtime's cycle guard and a problem row", async () => {
    const agent = await createAgent(setup);
    const { problems, trace } = await runTurn(agent, "Run the cycle");
    const skip = trace.find((e) => e.kind === "composition_skip");
    expect(skip).toMatchObject({ target: `${FIX.a}/cycle_a`, reason: "already visited in this request" });
    expect(problems).toEqual([[host(FIX.a), "Skipped: already visited in this request (a cycle)"]]);
    // The registry's own guard (remote.js checkCycle) throws COMPOSITION_CYCLE for the same chain.
    const chain = [`${FIX.a}::cycle_a`, `${FIX.b}::cycle_b`];
    let code = "";
    try {
      (agent.engine as unknown as { registry: { checkCycle(c: string[], o: string, n: string): void } }).registry.checkCycle(chain, FIX.a, "cycle_a");
    } catch (err) {
      code = (err as { code?: string }).code ?? "";
    }
    expect(code).toBe("COMPOSITION_CYCLE");
  });

  test(`§6.7 an over-budget request (more than ${MAX_REMOTE_CALLS} peer calls) stops with the runtime's limit and a problem row`, async () => {
    const agent = await createAgent(setup);
    const { problems, trace } = await runTurn(agent, "Fan out over budget");
    const reason = `the per-query limit of ${MAX_REMOTE_CALLS} third-party calls was reached`;
    expect(trace.filter((e) => e.kind === "remote_call" && e.phase === "start")).toHaveLength(MAX_REMOTE_CALLS);
    expect(trace.find((e) => e.kind === "composition_limit")).toMatchObject({ target: `${FIX.a}/fan_9`, reason });
    expect(problems).toEqual([[host(FIX.a), `Skipped: ${reason}`]]);
    // The ninth network was never fetched.
    expect(world.to(FIX.a).some((r) => r.url === `${FIX.a}/fan_9.network.json`)).toBe(false);
  });

  test("§6.7 a denied origin (outside the peer's allowed_peers) stops with the runtime's policy error and a problem row", async () => {
    const agent = await createAgent(setup);
    const { problems } = await runTurn(agent, "Try the denied origin");
    // The runtime names the calling manifest by its first network (engine.js _assertAllowedPeer).
    const error = `Policy: ${host(FIX.denied)} is not in broken's allowed_peers; refusing to contact it.`;
    expect(problems).toEqual([[DENIED_NETWORK, error]]);
    expect(world.to(FIX.denied)).toEqual([]);
  });

  test("§6.7 a denied origin (consent declined) stops with the runtime's consent note and a problem row", async () => {
    const asked: string[] = [];
    const agent = await createAgent(setup, { asked: [], answer: (req) => (asked.push(req.peerOrigin), "decline") });
    const before = world.to(FIX.a).length;
    const { problems, trace } = await runTurn(agent, "Ask echo, then decline");
    expect(asked).toEqual([host(FIX.a)]);
    expect(trace.find((e) => e.kind === "consent")).toMatchObject({ peerOrigin: host(FIX.a), decision: "declined" });
    expect(problems).toEqual([[host(FIX.a), `You declined to contact ${host(FIX.a)}. Nothing was sent to it.`]]);
    expect(world.to(FIX.a).length).toBe(before);
  });
});
