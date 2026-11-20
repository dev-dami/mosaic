import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { prebuilt } from "../src/prebuilt";
import type { Capability } from "../src/protocol";
import { runtimeRoute } from "../src/runtime-files";
import { AGENT_MANIFEST_PATH, agenticArtifacts, BRIDGE_MANIFEST_PATH, DEFAULT_LOOK, LINKS_PATH, networkPath } from "./agentic";
import { renderHome } from "./home";

/** Thrown by a capability's run when the input passed the schema but the site still cannot use it. */
export class InputError extends Error {}

export type CapabilityImpl = Capability & { run: (input: any) => unknown };

/** How the site's own approval prompt looks. The site owns this, not the host. */
export type SiteLook = { scheme: "light" | "dark"; accent: string; font: "sans" | "serif" | "mono" | "rounded" };

export type SiteDefinition = {
  name: string;
  description: string;
  port: number;
  look?: SiteLook;
  /** Set when an agent performs these capabilities on another site that did not publish them. */
  agent?: AgentInfo;
  capabilities: CapabilityImpl[];
};

/** Set on a site an agent performs on another site (Scout); published as the manifest's x_mosaic.agent. */
export type AgentInfo = { name: string; drives: string; learned_by: string };

export type BridgeConfig = {
  site: string;
  agent?: AgentInfo;
  allowed_hosts: string[];
  look: SiteLook;
  capabilities: (Pick<Capability, "id" | "title" | "description" | "side_effects" | "input_schema" | "output_schema"> & { fields: Record<string, string> })[];
};

export type Activity = { at: string; capability: string; input: unknown };

/** The nsdeploy action bridge (MVP 0.3): the skill's template page, this site's actions module and their config. */
export const ACTION_BRIDGE_PATH = "/bridge/action-bridge.html";
export const BRIDGE_ACTIONS_PATH = "/bridge/bridge-actions.js";
export const BRIDGE_CONFIG_PATH = "/bridge/bridge-config.json";
let bridgePage: string | undefined;
let actionsBundle: Promise<string> | undefined;

/** The skill's bridge page template; a deployment carries it in its bundle (src/prebuilt.ts). */
export function actionBridgePage(): string {
  bridgePage ??= prebuilt?.bridgePage ?? readFileSync(new URL("./bridge-page.html", import.meta.url), "utf8");
  return bridgePage;
}

/**
 * providers/bridge-actions.ts built for the browser once per process; every site serves the same
 * code. A deployment carries it prebuilt, so it never runs Bun.build on a request.
 */
export function bridgeActionsModule(): Promise<string> {
  if (prebuilt) return Promise.resolve(prebuilt.bridgeActions);
  actionsBundle ??= Bun.build({ entrypoints: [new URL("./bridge-actions.ts", import.meta.url).pathname], target: "browser", format: "esm", minify: true }).then(
    async (result) => {
      if (!result.success || !result.outputs[0]) throw new AggregateError(result.logs, "bridge-actions.ts did not build");
      return result.outputs[0].text();
    },
  );
  return actionsBundle;
}

export function createSite(def: SiteDefinition, origin: string, allowedHosts: string[]) {
  const ajv = new Ajv({ allErrors: true });
  ajv.addKeyword("x-mosaic-widget");
  ajv.addFormat("date-time", (value: string) => !Number.isNaN(Date.parse(value)));
  const validators = new Map(def.capabilities.map((c) => [c.id, ajv.compile(c.input_schema)]));
  const activity: Activity[] = [];

  const bridgeConfig: BridgeConfig = {
    site: def.name,
    ...(def.agent ? { agent: def.agent } : {}),
    allowed_hosts: allowedHosts,
    look: def.look ?? DEFAULT_LOOK,
    capabilities: def.capabilities.map(({ id, title, description, side_effects, input_schema, output_schema }) => ({
      id,
      title,
      description,
      side_effects,
      input_schema,
      output_schema,
      fields: Object.fromEntries(Object.entries(input_schema.properties ?? {}).map(([key, schema]) => [key, schema.title ?? key])),
    })),
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
    let output: unknown;
    try {
      output = await capability.run(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof InputError) return Response.json({ error: message }, { status: 400 });
      console.error(`${def.name}: ${id} failed:`, error);
      return Response.json({ error: `${def.name} could not do this: ${message}` }, { status: 500 });
    }
    if (capability.side_effects === "write") activity.unshift({ at: new Date().toISOString(), capability: id, input });
    return Response.json(output);
  }

  const homePage = () => renderHome(def, def.look ?? DEFAULT_LOOK, activity);

  return { bridgeConfig, agentic: agenticArtifacts(def), handleApi, homePage, activity };
}

export function serveSite(def: SiteDefinition, at: { port?: number; origin?: string } = {}) {
  const port = at.port ?? Number(process.env.PORT ?? def.port);
  const origin = at.origin ?? process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  const allowedHosts = (process.env.MOSAIC_HOSTS ?? "http://localhost:4000").split(",").map((s) => s.trim());
  const site = createSite(def, origin, allowedHosts);
  // Public agent artifacts: any origin may read them, never with credentials (spec §3.3, §3.4).
  const publicJson = (body: unknown) => () => Response.json(body, { headers: { "access-control-allow-origin": "*" } });

  const server = Bun.serve({
    port,
    routes: {
      "/": () => site.homePage(),
      // The action bridge a caller's runtime frames (reads) or opens in a popup (writes). Only
      // Mosaic hosts may frame it; no COOP, so the popup keeps its opener.
      [ACTION_BRIDGE_PATH]: () =>
        new Response(actionBridgePage(), {
          headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": `frame-ancestors ${allowedHosts.join(" ")}` },
        }),
      [BRIDGE_ACTIONS_PATH]: async () =>
        new Response(await bridgeActionsModule(), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } }),
      // Same origin only: read by the actions module inside the bridge.
      [BRIDGE_CONFIG_PATH]: () => Response.json(site.bridgeConfig),
      [AGENT_MANIFEST_PATH]: publicJson(site.agentic.agentManifest),
      [networkPath(def)]: publicJson(site.agentic.network),
      [LINKS_PATH]: publicJson(site.agentic.links),
      // Read only by the site's own bridge page, so it stays same-origin.
      [BRIDGE_MANIFEST_PATH]: () => Response.json(site.agentic.bridgeManifest),
      "/api/capabilities/:id": { POST: (req) => site.handleApi(req, req.params.id) },
      // The vendored nsdeploy browser runtime, for the site's agent pages and action bridge.
      ...runtimeRoute,
      // Result links (for example /releases/v1.0) land on the site's own page with its activity log.
      "/*": () => site.homePage(),
    },
  });
  console.log(`${def.name} on ${origin} (allows hosts: ${allowedHosts.join(", ")})`);
  return server;
}
