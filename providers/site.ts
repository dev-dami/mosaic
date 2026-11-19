import Ajv from "ajv";
import { MANIFEST_PATH, type Capability, type Manifest } from "../src/protocol";
import bridgePage from "./bridge.html";

export type CapabilityImpl = Capability & { run: (input: any) => unknown };

export type SiteDefinition = {
  name: string;
  description: string;
  port: number;
  capabilities: CapabilityImpl[];
};

export type BridgeConfig = {
  site: string;
  allowed_hosts: string[];
  capabilities: Pick<Capability, "id" | "title" | "side_effects">[];
};

type Activity = { at: string; capability: string; input: unknown };

const BRIDGE_PATH = "/mosaic/bridge";

export function createSite(def: SiteDefinition, origin: string, allowedHosts: string[]) {
  const ajv = new Ajv({ allErrors: true });
  ajv.addKeyword("x-mosaic-widget");
  const validators = new Map(def.capabilities.map((c) => [c.id, ajv.compile(c.input_schema)]));
  const activity: Activity[] = [];

  const manifest: Manifest = {
    mosaic: "capabilities/0",
    site: { name: def.name, origin, description: def.description },
    bridge: BRIDGE_PATH,
    capabilities: def.capabilities.map(({ run: _run, ...capability }) => capability),
  };

  const bridgeConfig: BridgeConfig = {
    site: def.name,
    allowed_hosts: allowedHosts,
    capabilities: def.capabilities.map(({ id, title, side_effects }) => ({ id, title, side_effects })),
  };

  /**
   * Only the site's own bridge page may call the API. A browser always sends Origin on a
   * cross-origin POST, so a host page that calls the API directly is refused here.
   */
  async function handleApi(req: Request, id: string): Promise<Response> {
    if (req.headers.get("origin") !== origin) {
      return Response.json({ error: "only this site's bridge may call its API" }, { status: 403 });
    }
    const capability = def.capabilities.find((c) => c.id === id);
    const validate = validators.get(id);
    if (!capability || !validate) return Response.json({ error: `unknown capability ${id}` }, { status: 404 });
    const input = await req.json().catch(() => undefined);
    if (!validate(input)) return Response.json({ error: ajv.errorsText(validate.errors) }, { status: 400 });
    const output = await capability.run(input);
    if (capability.side_effects === "write") activity.unshift({ at: new Date().toISOString(), capability: id, input });
    return Response.json(output);
  }

  function homePage(): Response {
    const rows = activity
      .map((a) => `<li><time>${a.at}</time> <b>${escapeHtml(a.capability)}</b> <code>${escapeHtml(JSON.stringify(a.input))}</code></li>`)
      .join("");
    const caps = def.capabilities.map((c) => `<li><b>${escapeHtml(c.title)}</b> (${c.side_effects}): ${escapeHtml(c.description)}</li>`).join("");
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>${escapeHtml(def.name)}</title>
<link rel="mosaic-capabilities" href="${MANIFEST_PATH}">
<style>body{font:15px system-ui;max-width:720px;margin:40px auto;padding:0 16px}code{font-size:12px}</style>
<h1>${escapeHtml(def.name)}</h1><p>${escapeHtml(def.description)}</p>
<p><small>Fictional demo site. Nothing leaves this server.</small></p>
<h2>Capabilities</h2><ul>${caps}</ul>
<h2>Activity</h2><ul id="activity">${rows || "<li>No changes yet.</li>"}</ul>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  return { manifest, bridgeConfig, handleApi, homePage, activity };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function serveSite(def: SiteDefinition) {
  const port = Number(process.env.PORT ?? def.port);
  const origin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  const allowedHosts = (process.env.MOSAIC_HOSTS ?? "http://localhost:4000").split(",").map((s) => s.trim());
  const site = createSite(def, origin, allowedHosts);

  const server = Bun.serve({
    port,
    routes: {
      "/": () => site.homePage(),
      [MANIFEST_PATH]: () =>
        Response.json(site.manifest, { headers: { "access-control-allow-origin": "*" } }),
      [BRIDGE_PATH]: bridgePage,
      "/mosaic/bridge-config": () => Response.json(site.bridgeConfig),
      "/api/capabilities/:id": { POST: (req) => site.handleApi(req, req.params.id) },
    },
  });
  console.log(`${def.name} on ${origin} (allows hosts: ${allowedHosts.join(", ")})`);
  return server;
}
