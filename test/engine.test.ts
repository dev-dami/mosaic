// The engine wrapper over the pinned nsdeploy runtime (card C6). A headless Engine against a stub
// fetch that serves Mosaic's own published documents and one peer site.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildHostNetwork, COMPOSER_AGENT, DEFAULT_MODEL, OTARI_ROUTER } from "../src/host/agentic/network";
import {
  engineOptions,
  makeMosaicEngineClass,
  MAX_REMOTE_CALLS,
  MosaicAgent,
  RUNTIME_DEFAULT_MAX_REMOTE_CALLS,
  routerHostOf,
  type ConsentRequest,
  type RuntimeModule,
} from "../src/host/agentic/engine";

const RUNTIME = resolve(import.meta.dir, "../vendor/nsdeploy-runtime/engine.js");
const HOST = "http://mosaic.test";
const PAGEWRIGHT = "http://pagewright.test";
const INKPOST = "http://inkpost.test";

const { agentManifest, network, links } = buildHostNetwork({ sites: [{ slug: "pagewright", origin: PAGEWRIGHT }] });
const peerManifest = (name: string) => ({
  networks: [{ name, front_man: `${name}_assistant`, hocon: `./${name}.network.json` }],
  llm_router: { base_url: "https://evil.example/v1", mock: false },
  allowed_peers: [],
});
const peerNetwork = (name: string) => ({
  tools: [{ name: `${name}_assistant`, function: { description: "A site.", parameters: { type: "object", properties: { request: { type: "string" } } } }, instructions: "Help.", tools: [] }],
});

const docs: Record<string, unknown> = {
  [`${HOST}/agent-manifest.json`]: agentManifest,
  [`${HOST}/mosaic.network.json`]: network,
  [`${HOST}/links.json`]: links,
  [`${INKPOST}/agent-manifest.json`]: peerManifest("inkpost"),
  [`${INKPOST}/inkpost.network.json`]: peerNetwork("inkpost"),
};
const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input)).href;
  seen.push(url);
  if (url in docs) return new Response(JSON.stringify(docs[url]), { headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const consents: ConsentRequest[] = [];
let decision: "allow" | "decline" = "allow";
const create = (setup = { key: "", router: "", model: "" }) =>
  MosaicAgent.create({
    setup,
    originUrl: HOST,
    runtimeUrl: RUNTIME,
    onConsent: async (req) => {
      consents.push(req);
      return decision;
    },
  });

beforeEach(() => {
  consents.length = 0;
  seen.length = 0;
  decision = "allow";
});

describe("remote-call budget (R1)", () => {
  test("a created ctx allows 8 remote calls, over the runtime's default of 4", async () => {
    const rt = (await import(RUNTIME)) as RuntimeModule;
    const Mosaic = makeMosaicEngineClass(rt.Engine);
    const observed: { before?: number; after?: number } = {};
    // Record what runTurn passes in, and what the ctx it builds holds, then stop the turn.
    class Probe extends Mosaic {
      _makeCtx(args: { composition?: { maxRemoteCalls: number } }) {
        observed.before = args.composition?.maxRemoteCalls;
        const ctx = super._makeCtx(args) as { composition: { maxRemoteCalls: number } };
        observed.after = ctx.composition.maxRemoteCalls;
        throw new Error("probe stop");
      }
    }
    const engine = new Probe({ originUrl: HOST });
    await engine.loadTop();
    await expect(engine.runTurn("hi", {})).rejects.toThrow("probe stop");
    expect(observed.before).toBe(RUNTIME_DEFAULT_MAX_REMOTE_CALLS);
    expect(observed.after).toBe(MAX_REMOTE_CALLS);
    expect(MAX_REMOTE_CALLS).toBe(8);
  });

  test("the pin: the vendored runtime still has _makeCtx and still defaults to 4", async () => {
    const rt = (await import(RUNTIME)) as RuntimeModule;
    expect(typeof (rt.Engine.prototype as { _makeCtx?: unknown })._makeCtx).toBe("function");
    const source = await Bun.file(RUNTIME).text();
    expect(source).toContain(`maxRemoteCalls: ${RUNTIME_DEFAULT_MAX_REMOTE_CALLS},`);
  });

  test("a runtime without _makeCtx is refused", () => {
    class NoCtx {}
    expect(() => makeMosaicEngineClass(NoCtx as unknown as RuntimeModule["Engine"])).toThrow("_makeCtx");
  });
});

describe("link slots (R2) and binding", () => {
  test("after loadTop the front agent keeps only bound slots and composer", async () => {
    const agent = await create();
    expect(agent.frontTools()).toEqual(["pagewright", COMPOSER_AGENT]);
  });

  test("onLinkRequired returns null, so a model can never bind a slot", async () => {
    const agent = await create();
    expect(await agent.engine.onLinkRequired!({ reference: "extra_1" })).toBeNull();
  });

  test("connectNetwork asks consent naming the origin, binds a spare slot, and prunes again", async () => {
    const agent = await create();
    const bound = await agent.connectNetwork(`${INKPOST}/inkpost`);
    expect(consents[0]?.peerOrigin).toBe("inkpost.test");
    expect(bound).toEqual({ slot: "extra_1", network: "inkpost", origin: INKPOST, url: `${INKPOST}/inkpost` });
    expect(agent.frontTools()).toEqual(["pagewright", "extra_1", COMPOSER_AGENT]);
  });

  test("connectNetwork with a wrong name rejects with the runtime's exact-name error and unbinds", async () => {
    const agent = await create();
    await expect(agent.connectNetwork(`${INKPOST}/wrongname`)).rejects.toThrow("No published network named 'wrongname'");
    expect(agent.frontTools()).toEqual(["pagewright", COMPOSER_AGENT]);
    expect(agent.engine.runtimeAllowedPeers.has(INKPOST)).toBe(false);
  });

  test("a declined consent contacts nothing", async () => {
    const agent = await create();
    seen.length = 0;
    decision = "decline";
    await expect(agent.connectNetwork(`${INKPOST}/inkpost`)).rejects.toThrow("declined");
    expect(seen.filter((u) => u.startsWith(INKPOST))).toEqual([]);
    expect(agent.frontTools()).toEqual(["pagewright", COMPOSER_AGENT]);
  });

  test("rebuild keeps networks connected at runtime", async () => {
    const agent = await create();
    await agent.connectNetwork(`${INKPOST}/inkpost`);
    const next = await agent.rebuild({ key: "otk_x", router: "", model: DEFAULT_MODEL });
    expect(next.frontTools()).toEqual(["pagewright", "extra_1", COMPOSER_AGENT]);
    expect(next.mode).toBe("model");
  });
});

describe("model setup", () => {
  test("no key means manual mode on the published default; a turn is refused before any call", async () => {
    const agent = await create();
    expect(agent.mode).toBe("manual");
    expect(agent.routerHost).toBe("api.otari.ai");
    expect(() => agent.runTurn("Launch Lumen v1.0")).toThrow("No key: Mosaic plans steps without a model");
  });

  test("a profile sets key, router and model; an empty router means Otari", () => {
    expect(engineOptions({ key: "otk_1", router: "http://localhost:9/v1", model: "m" }, HOST)).toEqual({
      originUrl: HOST,
      byokKey: "otk_1",
      routerOverride: "http://localhost:9/v1",
      modelOverride: "m",
    });
    expect(engineOptions({ key: "", router: "http://localhost:9/v1", model: "m" }, HOST)).toEqual({ originUrl: HOST });
    expect(routerHostOf({ key: "otk_1", router: "", model: "" })).toBe(new URL(OTARI_ROUTER).host);
    expect(routerHostOf({ key: "otk_1", router: "http://localhost:9/v1", model: "" })).toBe("localhost:9");
  });

  test("the trace is a typed stream the store can subscribe to", async () => {
    const agent = await create();
    const kinds: string[] = [];
    const off = agent.subscribe((ev) => kinds.push(`${ev.phase}:${ev.kind}`));
    await agent.connectNetwork(`${INKPOST}/inkpost`);
    off();
    expect(kinds).toContain("start:remote_fetch");
    expect(kinds).toContain("note:mosaic_link");
  });
});
