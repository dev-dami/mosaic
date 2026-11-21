import { afterAll, describe, expect, test } from "bun:test";
import { agenticArtifacts, AGENT_MANIFEST_PATH, BRIDGE_MANIFEST_PATH, LINKS_PATH, networkName, networkPath, OTARI_ROUTER, DEFAULT_MODEL } from "../providers/agentic";
import { agentsSite } from "../providers/agents";
import { announcerSite } from "../providers/announcer";
import { docsSite } from "../providers/docs";
import { issuesSite } from "../providers/issues";
import { newsletterSite } from "../providers/newsletter";
import { releasesSite } from "../providers/releases";
import { serveSite, type SiteDefinition } from "../providers/site";
import { videosSite } from "../providers/videos";
// The vendored runtime is plain JavaScript without types; these are the functions a caller's
// browser runs on what a site publishes.
// @ts-expect-error plain JS module without types
import { checkSchema, validateData } from "../vendor/nsdeploy-runtime/actions.js";
// @ts-expect-error plain JS module without types
import { parseHocon } from "../vendor/nsdeploy-runtime/hocon.js";
// @ts-expect-error plain JS module without types
import { AgentNetwork, validateNetwork } from "../vendor/nsdeploy-runtime/kernel.js";

const sites = [docsSite, releasesSite, announcerSite, newsletterSite, videosSite, issuesSite, agentsSite];

/** Load a published network file the way the runtime's Engine does (engine.js _compile). */
function loadNetwork(def: SiteDefinition) {
  const { network } = agenticArtifacts(def);
  return new AgentNetwork(parseHocon(JSON.stringify(network)), networkName(def));
}

describe("agentic artifacts for the demo sites", () => {
  test("network names are the slug of the site name", () => {
    expect(sites.map(networkName)).toEqual(["pagewright", "tagforge", "loudhailer", "inkpost", "reelhouse", "patchbay", "foreman"]);
    expect(networkName({ ...docsSite, name: "Marrow Point  Harbor-Tours!" })).toBe("marrow_point_harbor_tours");
    expect(networkName({ ...docsSite, name: "Ταβέρνα" })).toBe("site");
  });

  for (const def of sites) {
    describe(def.name, () => {
      const slug = networkName(def);
      const { agentManifest, network, links, bridgeManifest } = agenticArtifacts(def);

      test("the runtime's network validator finds no errors and picks the front agent", () => {
        const net = loadNetwork(def);
        expect(validateNetwork(net).errors).toEqual([]);
        expect(net.findFrontMan()).toBe(`${slug}_assistant`);
      });

      test("the runtime's checkSchema accepts every input and output schema", () => {
        for (const cap of def.capabilities) {
          expect(() => checkSchema(cap.input_schema), `${cap.id} input`).not.toThrow();
          expect(() => checkSchema(cap.output_schema), `${cap.id} output`).not.toThrow();
        }
      });

      // The runtime validates every result against outputSchema and refuses keys it does not list.
      test("reads runnable from their defaults return data matching their output schema", async () => {
        const defaults = (cap: (typeof def.capabilities)[number]) =>
          Object.fromEntries(Object.entries(cap.input_schema.properties ?? {}).flatMap(([k, s]) => (s.default === undefined ? [] : [[k, s.default]])));
        const runnable = def.capabilities.filter((c) => c.side_effects === "read" && (c.input_schema.required ?? []).every((k) => k in defaults(c)));
        for (const cap of runnable) {
          const out = await cap.run(defaults(cap));
          expect(() => validateData(cap.output_schema, JSON.parse(JSON.stringify(out)), "result"), cap.id).not.toThrow();
        }
      });

      test("the manifest names one network, the Otari router, a closed peer policy and the agent tools", () => {
        expect(agentManifest).toMatchObject({
          brand: def.name,
          networks: [{ name: slug, front_man: `${slug}_assistant`, hocon: `./${slug}.network.json`, description: def.description }],
          llm_router: { base_url: OTARI_ROUTER, mock: false, byok_router: OTARI_ROUTER },
          allowed_peers: [],
          peer_policy: { mode: "closed" },
          theme: { primary: def.look!.accent },
          actions: { version: 1, bridge: "./bridge/action-bridge.html", agentTools: def.capabilities.map((c) => c.id) },
          linking: { protocol: "nsdeploy-link/v1", exports: [{ network: slug, front_man: `${slug}_assistant`, url: slug }] },
        });
        expect(agentManifest.x_mosaic).toBeUndefined();
      });

      test("the front agent takes one plain-language request and lists every capability", () => {
        const front = network.tools[0]!;
        expect(network.tools).toHaveLength(1);
        expect(front.function.parameters).toEqual({
          type: "object",
          properties: { request: { type: "string", description: expect.any(String) } },
          required: ["request"],
        });
        for (const cap of def.capabilities) expect(front.instructions).toContain(`website_${cap.id}`);
        expect(network.llm_config).toEqual({ model_name: DEFAULT_MODEL });
      });

      test("links.json and the bridge manifest name the same network", () => {
        expect(links).toEqual({ version: 1, networks: { [slug]: {} } });
        expect(bridgeManifest).toEqual({ networks: [{ name: slug }], actions: { version: 1, module: "./bridge-actions.js" } });
        expect(networkPath(def)).toBe(`/${slug}.network.json`);
      });
    });
  }

  test("a site run by an agent says so in x_mosaic and in the instructions", () => {
    const agent = { name: "Scout", drives: "http://localhost:4300", learned_by: "heuristic" };
    const { agentManifest, network } = agenticArtifacts({ ...docsSite, agent });
    expect(agentManifest.x_mosaic).toEqual({ agent });
    expect(network.tools[0]!.instructions).toContain("http://localhost:4300");
    expect(validateNetwork(new AgentNetwork(parseHocon(JSON.stringify(network)), "pagewright")).errors).toEqual([]);
  });
});

describe("serveSite publishes the agentic artifacts", () => {
  const server = serveSite(docsSite, { port: 0 });
  afterAll(() => server.stop(true));
  const get = (path: string) => fetch(new URL(path, server.url), { headers: { origin: "https://caller.example" } });

  for (const path of [AGENT_MANIFEST_PATH, "/pagewright.network.json", LINKS_PATH]) {
    test(`${path} is public JSON any origin may read, without credentials`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(res.headers.get("content-type")).toContain("application/json");
      await res.json();
    });
  }

  test("the served files are the generated ones", async () => {
    const { agentManifest, network } = agenticArtifacts(docsSite);
    expect(await (await get(AGENT_MANIFEST_PATH)).json()).toEqual(agentManifest);
    expect(await (await get("/pagewright.network.json")).json()).toEqual(network);
  });

  test("the bridge manifest is same-origin only", async () => {
    const res = await get(BRIDGE_MANIFEST_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.json()).toEqual(agenticArtifacts(docsSite).bridgeManifest);
  });
});
