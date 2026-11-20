// Test-only networks that must be refused (MVP Profile 0.3 §6 check 7). They publish the same
// public files as a real site (agent-manifest.json, <network>.network.json, links.json), so the
// vendored runtime meets them the way it meets any site. Served only by the conformance tests
// (test/conformance/) and the browser runbook (e2e/areas/interop.cjs) through ./serve.ts; no
// deploy role (src/roles.ts) and no dev script serves them.
//
// Origin A publishes:
//   broken     a network whose front agent calls an agent it does not define (fails validation);
//   cycle_a    calls cycle_b on origin B by URL; cycle_b calls cycle_a back (a composition cycle);
//   stray      calls a network on an origin A's manifest does not allow (a denied origin);
//   fan_1..9   nine one-agent networks, one more than the per-turn budget of 8 peer calls;
//   echo       a plain network the §6.4-§6.6 checks call.
// Origin B publishes cycle_b.

const request = {
  type: "object",
  properties: { request: { type: "string", description: "The request in plain language." } },
  required: ["request"],
};

type Agent = { name: string; function: { description: string; parameters: typeof request }; instructions: string; tools: string[] };
export type FixtureNetwork = { metadata: { description: string }; tools: Agent[]; link_slots?: Record<string, object> };

const agent = (name: string, description: string, tools: string[] = []): Agent => ({
  name,
  function: { description, parameters: request },
  instructions: `${description} Answer in one sentence.`,
  tools,
});

const oneAgent = (network: string, description: string, tools: string[] = []): FixtureNetwork => ({
  metadata: { description },
  tools: [agent(`${network}_assistant`, description, tools)],
});

/** The network name nobody publishes, on an origin nobody allows. */
export const DENIED_NETWORK = "anything";
export const FAN_OUT = Array.from({ length: 9 }, (_, i) => `fan_${i + 1}`);
export const GHOST_AGENT = "ghost_agent";

export type FixtureOrigins = { a: string; b: string; denied: string };

/** The networks each fixture origin publishes, by name. */
export function fixtureNetworks(role: "a" | "b", at: FixtureOrigins): Record<string, FixtureNetwork> {
  if (role === "b") return { cycle_b: oneAgent("cycle_b", "Cycle B: hands every request to cycle A.", [`${at.a}/cycle_a`]) };
  return {
    broken: oneAgent("broken", "A network that calls an agent it does not define.", [GHOST_AGENT]),
    cycle_a: oneAgent("cycle_a", "Cycle A: hands every request to cycle B.", [`${at.b}/cycle_b`]),
    stray: oneAgent("stray", "Calls a site its own manifest does not allow.", [`${at.denied}/${DENIED_NETWORK}`]),
    echo: oneAgent("echo", "Echo: says what it was asked."),
    ...Object.fromEntries(FAN_OUT.map((name) => [name, oneAgent(name, `Fan-out network ${name}.`)])),
  };
}

/** The public files of one fixture origin, by path. */
export function fixtureFiles(role: "a" | "b", at: FixtureOrigins): Record<string, unknown> {
  const networks = fixtureNetworks(role, at);
  const names = Object.keys(networks);
  const manifest = {
    brand: role === "a" ? "Fixtures A" : "Fixtures B",
    networks: names.map((name) => ({ name, front_man: `${name}_assistant`, hocon: `./${name}.network.json`, description: networks[name]!.metadata.description })),
    // A peer's router is informational only: the caller's router runs this network (spec §4).
    llm_router: { base_url: "https://fixtures-router.invalid/v1", mock: false, byok_router: "https://fixtures-router.invalid/v1" },
    allowed_peers: [role === "a" ? at.b : at.a],
    peer_policy: { mode: "closed", deny_origins: [], note: "Test fixtures. Calls only the other fixture origin." },
  };
  return {
    "/agent-manifest.json": manifest,
    "/links.json": { version: 1, networks: Object.fromEntries(names.map((n) => [n, {}])) },
    ...Object.fromEntries(names.map((name) => [`/${name}.network.json`, networks[name]])),
  };
}
