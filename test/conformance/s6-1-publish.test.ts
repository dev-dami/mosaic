// MVP Profile 0.3 §6 check 1: "Publish a two-agent HOCON network and a manifest from an ordinary
// HTTPS web host." Mosaic's host network has two agents and validates in the vendored runtime;
// every demo site's network validates; and the sponsor's own check_partner.mjs (vendored, unchanged)
// passes for the host and for each demo site, served over HTTP on free ports. HTTPS is the live
// deploy's part (docs/judging.md, TODO(verify) after C13b).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { join } from "node:path";
import { agenticArtifacts } from "../../providers/agentic";
import { agentsSite } from "../../providers/agents";
import { announcerSite } from "../../providers/announcer";
import { docsSite } from "../../providers/docs";
import { issuesSite } from "../../providers/issues";
import { newsletterSite } from "../../providers/newsletter";
import { releasesSite } from "../../providers/releases";
import { serveSite, type SiteDefinition } from "../../providers/site";
import { videosSite } from "../../providers/videos";
import { buildHostNetwork, COMPOSER_AGENT, FRONT_AGENT } from "../../src/host/agentic/network";
// @ts-expect-error The vendored runtime ships no type declarations.
import { AgentNetwork, validateNetwork } from "../../vendor/nsdeploy-runtime/kernel.js";

const CHECK_PARTNER = join(import.meta.dir, "../../vendor/agentic-web-scripts/scripts/check_partner.mjs");
const CALLER = "http://localhost:4000";
const SITES: SiteDefinition[] = [docsSite, releasesSite, announcerSite, newsletterSite, videosSite, issuesSite, agentsSite];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

async function checkPartner(url: string, origin = CALLER) {
  const proc = Bun.spawn(["node", CHECK_PARTNER, url, "--origin", origin], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out: out + err, code };
}

const servers: { stop(force?: boolean): unknown }[] = [];
const served: { def?: SiteDefinition; url: string }[] = [];
const host = buildHostNetwork({ sites: [{ slug: "pagewright", origin: "http://localhost:4101" }] });

beforeAll(async () => {
  for (const def of SITES) {
    const port = await freePort();
    servers.push(serveSite(def, { port, origin: `http://localhost:${port}` }));
    served.push({ def, url: `http://localhost:${port}/${agenticArtifacts(def).agentManifest.networks[0]!.name}` });
  }
  // The host's three public files, as src/host/server.ts serves them (test/host-network.test.ts).
  const files: Record<string, unknown> = { "/agent-manifest.json": host.agentManifest, "/mosaic.network.json": host.network, "/links.json": host.links };
  const hostServer = Bun.serve({
    port: 0,
    fetch: (req) => {
      const body = files[new URL(req.url).pathname];
      return body ? Response.json(body, { headers: { "access-control-allow-origin": "*" } }) : new Response("not found", { status: 404 });
    },
  });
  servers.push(hostServer);
  served.push({ url: `http://localhost:${hostServer.port}/mosaic` });
});
afterAll(() => {
  for (const s of servers) s.stop(true);
});

describe("§6.1 publish a two-agent network and a manifest", () => {
  test("§6.1 the host publishes a two-agent network (front mosaic, internal composer) that the runtime validates", () => {
    const net = new AgentNetwork(host.network, "mosaic");
    expect(validateNetwork(net).errors).toEqual([]);
    expect(net.findFrontMan()).toBe(FRONT_AGENT);
    expect(host.network.tools.map((t) => t.name)).toEqual([FRONT_AGENT, COMPOSER_AGENT]);
    expect(host.network.tools[0]!.tools).toContain(COMPOSER_AGENT);
    expect(host.agentManifest.networks[0]).toMatchObject({ name: "mosaic", front_man: FRONT_AGENT, hocon: "./mosaic.network.json" });
    expect(host.agentManifest.llm_router.base_url).toMatch(/^https:\/\//);
  });

  test("§6.1 every demo site's network validates in the runtime", () => {
    for (const def of SITES) {
      const { network, agentManifest } = agenticArtifacts(def);
      const name = agentManifest.networks[0]!.name;
      expect([name, validateNetwork(new AgentNetwork(network, name)).errors]).toEqual([name, []]);
    }
  });

  test("§6.1 check_partner.mjs passes for the host and for every demo site", async () => {
    const results = await Promise.all(served.map(async ({ url }) => ({ url, ...(await checkPartner(url)) })));
    for (const r of results) {
      expect(r.out, r.url).not.toContain("ERROR");
      expect([r.url, r.code]).toEqual([r.url, 0]);
    }
    expect(results).toHaveLength(SITES.length + 1);
  }, 60_000);
});
