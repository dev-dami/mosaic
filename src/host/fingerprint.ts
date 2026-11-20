import { createHash } from "node:crypto";

const root = `${import.meta.dir}/../..`;

/**
 * A fingerprint of Mosaic's own source. The workspace shows it, and checks it again after each
 * site is connected, so anyone can see that connecting a site needs no Mosaic change. A deployment
 * computes it at build time (scripts/build-deploy.ts), since it ships no sources.
 */
export async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  const files = [...new Bun.Glob("src/**/*.{ts,tsx,html,css}").scanSync({ cwd: root })].sort();
  for (const file of files) hash.update(file).update(await Bun.file(`${root}/${file}`).bytes());
  return hash.digest("hex").slice(0, 7);
}
