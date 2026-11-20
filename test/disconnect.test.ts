// Disconnecting a site unlinks it in Mosaic's agent, not only in the workspace (C7 fix 5): its slot
// frees up, the origin is no longer allowed, the resolved network and its actions are gone, and it
// can be connected again. A headless Engine against a stub fetch, like test/engine.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildHostNetwork, SPARE_SLOTS } from "../src/host/agentic/network";
import { MosaicAgent } from "../src/host/agentic/engine";

const RUNTIME = resolve(import.meta.dir, "../vendor/nsdeploy-runtime/engine.js");
const HOST = "http://mosaic.test";
const INKPOST = "http://inkpost.test";

const { agentManifest, network, links } = buildHostNetwork({ sites: [] });
const docs: Record<string, unknown> = {
  [`${HOST}/agent-manifest.json`]: agentManifest,
  [`${HOST}/mosaic.network.json`]: network,
  [`${HOST}/links.json`]: links,
  [`${INKPOST}/agent-manifest.json`]: { networks: [{ name: "inkpost", front_man: "inkpost_assistant", hocon: "./inkpost.network.json" }], allowed_peers: [] },
  [`${INKPOST}/inkpost.network.json`]: {
    tools: [{ name: "inkpost_assistant", function: { description: "A site.", parameters: { type: "object", properties: { request: { type: "string" } } } }, instructions: "Help.", tools: [] }],
  },
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input)).href;
  if (url in docs) return new Response(JSON.stringify(docs[url]), { headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("disconnectNetwork", () => {
  test("frees the slot, the origin, the cached network and its actions; it can connect again", async () => {
    const agent = await MosaicAgent.create({ setup: { key: "", router: "", model: "" }, originUrl: HOST, runtimeUrl: RUNTIME, onConsent: async () => "allow" });
    const engine = agent.engine;
    const net = engine.top!.network;
    const url = `${INKPOST}/inkpost`;

    const bound = await agent.connectNetwork(url);
    expect(bound.slot).toBe(SPARE_SLOTS[0]!);
    expect(agent.frontTools()).toContain(bound.slot);
    expect(engine.runtimeAllowedPeers.has(INKPOST)).toBe(true);
    expect(engine.registry.cache.has(`${INKPOST}::inkpost`)).toBe(true);
    // A stand-in for an action the site's bridge registered.
    engine.actions.entries.set(`${url}#x`, { ref: `${url}#x`, name: "x", description: "d", inputSchema: { type: "object", properties: {} }, effect: "read", availability: "bridge", base: INKPOST, network: "inkpost" });

    agent.disconnectNetwork(url);
    expect(net.getLink(bound.slot)).toBeNull();
    expect(agent.frontTools()).not.toContain(bound.slot);
    expect(agent.connected).toHaveLength(0);
    expect(engine.runtimeAllowedPeers.has(INKPOST)).toBe(false);
    expect(engine.registry.cache.has(`${INKPOST}::inkpost`)).toBe(false);
    expect(engine.actions.entries.has(`${url}#x`)).toBe(false);
    // Unlinked and no longer allowed: the runtime refuses to resolve it.
    await expect(engine.resolveRemote(url, [], null)).rejects.toThrow();

    const again = await agent.connectNetwork(url);
    expect(again.slot).toBe(SPARE_SLOTS[0]!);
  });
});
