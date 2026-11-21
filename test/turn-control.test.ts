// Turn control in Mosaic's agent (C9 fixes): Stop declines new contact requests and clears the
// waiting ones; allowing "Connect <site>?" allows that site in later turns until it is
// disconnected; "Always allow" survives a model change; the registry runs writes one at a time.
// A headless Engine against a stub fetch, like test/disconnect.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildHostNetwork } from "../src/host/agentic/network";
import { MosaicAgent, type ConsentRequest } from "../src/host/agentic/engine";
import type { RegistryEntry } from "../src/host/agentic/catalog";

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

const asked: ConsentRequest[] = [];
let cancelled = 0;
const create = (setup = { key: "", router: "", model: "" }) =>
  MosaicAgent.create({
    setup,
    originUrl: HOST,
    runtimeUrl: RUNTIME,
    onConsent: async (req) => {
      asked.push(req);
      return "allow";
    },
    cancelConsents: () => {
      cancelled += 1;
    },
  });

describe("turn control", () => {
  test("after Stop, contact requests are declined unasked; connecting still asks; the next turn asks again", async () => {
    const agent = await create({ key: "k", router: "http://router.test/v1", model: "m" });
    asked.length = 0;
    agent.stopTurn();
    expect(cancelled).toBe(1);
    expect(await agent.engine.requestConsent({ kind: "network", peerOrigin: "a.test" })).toBe("decline");
    expect(asked).toHaveLength(0);
    expect(await agent.engine.requestConsent({ kind: "connect", peerOrigin: "a.test" })).toBe("allow");
    expect(asked.map((r) => r.kind)).toEqual(["connect"]);
    // A new turn clears the stop (the stream itself fails here: no router is reachable).
    void agent.runTurn("x");
    expect(await agent.engine.requestConsent({ kind: "network", peerOrigin: "b.test" })).toBe("allow");
  });

  test("allowing Connect allows that site in turns; disconnect takes it back; a model change keeps it", async () => {
    const agent = await create();
    asked.length = 0;
    await agent.connectNetwork(`${INKPOST}/inkpost`, { consented: true });
    expect(agent.engine.consent.get("inkpost.test")).toBe("always");
    // A turn's peer call to it does not ask again; a site never connected still asks.
    expect(await agent.engine.requestConsent({ kind: "network", peerOrigin: "inkpost.test" })).toBe("allow");
    expect(asked).toHaveLength(0);
    await agent.engine.requestConsent({ kind: "network", peerOrigin: "other.test" });
    expect(asked.map((r) => r.peerOrigin)).toEqual(["other.test"]);

    const next = await agent.rebuild({ key: "k2", router: "http://router.test/v1", model: "m2" });
    expect(next.engine.consent.get("inkpost.test")).toBe("always");

    next.disconnectNetwork(`${INKPOST}/inkpost`);
    expect(next.engine.consent.has("inkpost.test")).toBe(false);
    asked.length = 0;
    await next.engine.requestConsent({ kind: "network", peerOrigin: "inkpost.test" });
    expect(asked).toHaveLength(1);
  });

  test("the registry runs writes one at a time, reads alongside", async () => {
    const agent = await create();
    const log: string[] = [];
    const entry = (name: string, effect: RegistryEntry["effect"]) =>
      ({
        ref: `${INKPOST}/inkpost#${name}`,
        name,
        description: name,
        inputSchema: { type: "object", properties: {} },
        effect,
        availability: "bridge",
        base: INKPOST,
        network: "inkpost",
        timeoutMs: 5000,
        execute: async () => {
          log.push(`start ${name}`);
          await new Promise((r) => setTimeout(r, 30));
          log.push(`end ${name}`);
          return {};
        },
      }) as unknown as RegistryEntry;
    const started: string[] = [];
    agent.watchActions({ start: (run) => started.push(run.entries[0]!.name) });
    const yes = async () => true;
    await Promise.all([
      agent.engine.actions.execute([{ entry: entry("w1", "write"), args: {} }], yes, "i1"),
      agent.engine.actions.execute([{ entry: entry("w2", "write"), args: {} }], yes, "i2"),
      agent.engine.actions.execute([{ entry: entry("r1", "read"), args: {} }], yes, "i3"),
    ]);
    expect(log.indexOf("end w1")).toBeLessThan(log.indexOf("start w2"));
    expect(log.indexOf("start r1")).toBeLessThan(log.indexOf("end w1"));
    // The second write is reported only once it really starts.
    expect(started.indexOf("w2")).toBeGreaterThan(started.indexOf("r1"));
  });
});
