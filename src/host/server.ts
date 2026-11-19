import { createHash } from "node:crypto";
import homepage from "./index.html";

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

Bun.serve({
  port,
  routes: {
    "/": homepage,
    "/mosaic-host.json": () => Response.json({ build, suggestions }, { headers: { "cache-control": "no-store" } }),
  },
  development: process.env.NODE_ENV !== "production",
});
console.log(`Mosaic on http://localhost:${port} (build ${build})`);
