import { describe, expect, test } from "bun:test";
// @ts-expect-error The vendored runtime ships no type declarations.
import { AgentNetwork, validateNetwork } from "../vendor/nsdeploy-runtime/kernel.js";
import { buildHostNetwork, parseSiteOrigins, SPARE_SLOTS } from "../src/host/agentic/network";

const SLUGS = ["pagewright", "tagforge", "loudhailer", "inkpost", "reelhouse", "patchbay", "foreman"];
const SITE_ORIGINS = SLUGS.map((slug, i) => `${slug}=http://localhost:${4101 + i}`).join(",");
const sites = parseSiteOrigins(SITE_ORIGINS);
const { agentManifest, network, links } = buildHostNetwork({ sites });

describe("parseSiteOrigins", () => {
  test("reads slug=origin pairs, lowercases slugs and keeps only the origin", () => {
    expect(parseSiteOrigins(" Pagewright=http://localhost:4101/ , tagforge=https://tagforge.example/x ")).toEqual([
      { slug: "pagewright", origin: "http://localhost:4101" },
      { slug: "tagforge", origin: "https://tagforge.example" },
    ]);
  });

  test("a bare origin takes its slug from the first hostname label", () => {
    expect(parseSiteOrigins("https://loud-hailer.example.com")).toEqual([{ slug: "loudhailer", origin: "https://loud-hailer.example.com" }]);
  });

  test("ignores empty entries and throws on a value that is not a URL", () => {
    expect(parseSiteOrigins("")).toEqual([]);
    expect(parseSiteOrigins(" , ")).toEqual([]);
    expect(() => parseSiteOrigins("pagewright=not a url")).toThrow();
  });

  test("a bare loopback origin has no name to take, so it is refused", () => {
    expect(() => parseSiteOrigins("http://localhost:4101")).toThrow(/slug/);
  });
});

describe("the Mosaic host network", () => {
  const net = new AgentNetwork(network, "mosaic");

  test("the vendored validator returns no errors", () => {
    expect(validateNetwork(net).errors).toEqual([]);
  });

  test("turns on CRUSE, so the front agent can answer with a choice or confirm", () => {
    expect(net.config.cruse).toBe(true);
    expect(net.getAgentSpec("mosaic")?.instructions).toContain("render_cruse");
  });

  test("has a front agent mosaic and an internal agent composer", () => {
    const names = (network.tools as { name: string }[]).map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toContain("composer");
    expect(net.findFrontMan()).toBe("mosaic");
    expect(net.getAgentSpec("mosaic")?.tools).toContain("composer");
  });

  test("only project and version may cross to a downstream site", () => {
    expect(net.getAgentSpec("mosaic")?.allow).toEqual({ to_downstream: { sly_data: ["project", "version"] } });
    expect(net.getAgentSpec("composer")?.allow).toBeUndefined();
  });

  test("link slots cover every suggested site plus four spares, all offered to the front agent", () => {
    expect([...SPARE_SLOTS]).toEqual(["extra_1", "extra_2", "extra_3", "extra_4"]);
    expect([...net.linkSlots].sort()).toEqual([...SLUGS, ...SPARE_SLOTS].sort());
    for (const slot of net.linkSlots) expect(net.getAgentSpec("mosaic")?.tools).toContain(slot);
  });

  test("links.json binds each suggested slot to <origin>/<slug> and leaves the spares unbound", () => {
    expect(links.version).toBe(1);
    expect(links.networks.mosaic).toEqual(Object.fromEntries(sites.map((s) => [s.slug, `${s.origin}/${s.slug}`])));
    expect(Object.keys(links.networks.mosaic)).toHaveLength(7);
    // Loaded the way the engine loads it, the slots resolve and the spares stay open.
    const bound = new AgentNetwork({ ...network, links: links.networks.mosaic }, "mosaic");
    expect(bound.getLink("pagewright")).toBe("http://localhost:4101/pagewright");
    expect(bound.getLink("extra_1")).toBeNull();
    expect(validateNetwork(bound).errors).toEqual([]);
  });

  test("the manifest publishes the network, the Otari router and a closed peer list", () => {
    expect(agentManifest.networks).toHaveLength(1);
    const entry = agentManifest.networks[0]!;
    expect(entry).toMatchObject({ name: "mosaic", front_man: "mosaic", hocon: "./mosaic.network.json" });
    expect(entry.description.length).toBeGreaterThan(0);
    expect(entry.sample_queries.length).toBeGreaterThan(0);
    expect(agentManifest.llm_router).toEqual({ base_url: "https://api.otari.ai/api/v1", mock: false, byok_router: "https://api.otari.ai/api/v1" });
    expect(network.llm_config).toEqual({ model_name: "alibaba/qwen3.8-flash" });
    expect(agentManifest.allowed_peers).toEqual(sites.map((s) => s.origin));
    expect(agentManifest.peer_policy.mode).toBe("closed");
  });

  test("with no sites it still validates and keeps the spares", () => {
    const empty = buildHostNetwork({ sites: [] });
    const n = new AgentNetwork(empty.network, "mosaic");
    expect(validateNetwork(n).errors).toEqual([]);
    expect([...n.linkSlots]).toEqual([...SPARE_SLOTS]);
    expect(empty.agentManifest.allowed_peers).toEqual([]);
    expect(empty.links.networks.mosaic).toEqual({});
  });
});

describe("the Mosaic host serves its agentic artifacts", () => {
  test("GET /agent-manifest.json, /mosaic.network.json and /links.json answer 200 with ACAO *", async () => {
    const port = 4800 + Math.floor(Math.random() * 90);
    const host = Bun.spawn(["bun", "src/host/server.ts"], {
      env: { ...process.env, PORT: String(port), SITE_ORIGINS },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const get = async (path: string) => {
        for (let i = 0; i < 100; i++) {
          const res = await fetch(`http://localhost:${port}${path}`).catch(() => undefined);
          if (res) return res;
          await Bun.sleep(100);
        }
        throw new Error(`host never answered ${path}`);
      };
      for (const [path, body] of [
        ["/agent-manifest.json", agentManifest],
        ["/mosaic.network.json", network],
        ["/links.json", links],
      ] as const) {
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("access-control-allow-credentials")).toBeNull();
        expect(await res.json()).toEqual(JSON.parse(JSON.stringify(body)));
      }
    } finally {
      host.kill();
      await host.exited;
    }
  }, 20_000);
});
