import { createHash } from "node:crypto";
import homepage from "./index.html";
import { runtimeRoute } from "../runtime-files";
import { buildHostNetwork, parseSiteOrigins } from "./agentic/network";

const port = Number(process.env.PORT ?? 4000);

/**
 * A fingerprint of Mosaic's own source at startup. The workspace shows it, and checks it again
 * after each site is connected, so anyone can see that connecting a site needs no Mosaic change.
 */
async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  const files = [...new Bun.Glob("src/**/*.{ts,tsx,html,css}").scanSync({ cwd: `${import.meta.dir}/../..` })].sort();
  for (const file of files) hash.update(file).update(await Bun.file(`${import.meta.dir}/../../${file}`).bytes());
  return hash.digest("hex").slice(0, 7);
}

const build = await sourceFingerprint();
// Optional site URLs to suggest on the empty page (the dev script passes the demo sites).
const suggestions = (process.env.MOSAIC_SUGGEST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// Optional: Scout's origin. With it, a site that publishes no manifest can be learned instead of refused.
const agent = process.env.MOSAIC_AGENT || undefined;
// Mosaic is itself an open agentic website: its manifest, its "mosaic" network and links.json are
// public, readable from any origin, and never sent with credentials.
const agentic = buildHostNetwork({ sites: parseSiteOrigins(process.env.SITE_ORIGINS ?? "") });
const publicJson = (body: unknown) => () =>
  Response.json(body, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });

Bun.serve({
  port,
  routes: {
    "/": homepage,
    "/mosaic-host.json": () => Response.json({ build, suggestions, agent }, { headers: { "cache-control": "no-store" } }),
    "/agent-manifest.json": publicJson(agentic.agentManifest),
    "/mosaic.network.json": publicJson(agentic.network),
    "/links.json": publicJson(agentic.links),
    // The vendored nsdeploy browser runtime that runs Mosaic's own agent network.
    ...runtimeRoute,
  },
  development: process.env.NODE_ENV !== "production",
});
console.log(`Mosaic on http://localhost:${port} (build ${build})`);
