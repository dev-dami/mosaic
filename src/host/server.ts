import { prebuilt, type PrebuiltFile } from "../prebuilt";
import { runtimeRoute } from "../runtime-files";
import { buildHostNetwork, parseSiteOrigins } from "./agentic/network";
import { hostCsp } from "./csp";
import { sourceFingerprint } from "./fingerprint";

const port = Number(process.env.PORT ?? 4000);

const build = prebuilt?.fingerprint ?? (await sourceFingerprint());
// Optional site URLs to suggest on the empty page (the dev script passes the demo sites).
const suggestions = (process.env.MOSAIC_SUGGEST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// Optional: Scout's origin. With it, a site that publishes no manifest can be learned instead of refused.
const agent = process.env.MOSAIC_AGENT || undefined;
const sites = parseSiteOrigins(process.env.SITE_ORIGINS ?? "");
// Mosaic is itself an open agentic website: its manifest, its "mosaic" network and links.json are
// public, readable from any origin, and never sent with credentials.
const agentic = buildHostNetwork({ sites });
const publicJson = (body: unknown) => () =>
  Response.json(body, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });

/**
 * The page. From source it is the HTML import, bundled by Bun on the fly. A deployment serves the
 * page the deploy build made, under a policy that limits it to the configured sites.
 */
async function pageRoutes(): Promise<Record<string, unknown>> {
  if (!prebuilt) return { "/": (await import("./dev-homepage")).default };
  const csp = hostCsp({
    siteOrigins: [...sites.map((s) => s.origin), ...suggestions],
    agent,
    extra: (process.env.MOSAIC_CSP_ORIGINS ?? "").split(/[\s,]+/).filter(Boolean),
  });
  const serve = (path: string, file: PrebuiltFile) => {
    const body = file.base64 ? Buffer.from(file.body, "base64") : file.body;
    const headers: Record<string, string> = {
      "content-type": file.type,
      "cache-control": path === "/" ? "no-cache" : "public, max-age=31536000, immutable",
    };
    if (path === "/") headers["content-security-policy"] = csp;
    return () => new Response(body, { headers });
  };
  return Object.fromEntries(Object.entries(prebuilt.host).map(([path, file]) => [path, serve(path, file)]));
}

Bun.serve({
  port,
  routes: {
    ...((await pageRoutes()) as Record<string, () => Response>),
    "/mosaic-host.json": () => Response.json({ build, suggestions, agent }, { headers: { "cache-control": "no-store" } }),
    "/agent-manifest.json": publicJson(agentic.agentManifest),
    "/mosaic.network.json": publicJson(agentic.network),
    "/links.json": publicJson(agentic.links),
    // The vendored nsdeploy browser runtime that runs Mosaic's own agent network.
    ...runtimeRoute,
  },
  development: !prebuilt && process.env.NODE_ENV !== "production",
});
console.log(`Mosaic on http://localhost:${port} (build ${build})`);
