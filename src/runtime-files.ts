import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

/** The vendored nsdeploy browser runtime (vendor/nsdeploy-runtime/VENDOR.md). Never edited here. */
export const RUNTIME_DIR = resolve(import.meta.dir, "../vendor/nsdeploy-runtime");
export const RUNTIME_PREFIX = "/runtime/";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * The response for a /runtime/* path: the runtime's JavaScript modules only, never its README,
 * license or vendor notes, and never a file outside the runtime folder. The runtime is public
 * code, so any origin may import it.
 */
export function runtimeFile(pathname: string): Response {
  if (!pathname.startsWith(RUNTIME_PREFIX)) return notFound();
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(RUNTIME_PREFIX.length));
  } catch {
    return notFound();
  }
  if (!/\.m?js$/.test(rel) || rel.includes("\0") || rel.includes("\\") || rel.split("/").some((p) => p === ".." || p === "." || p === "")) {
    return notFound();
  }
  const file = resolve(RUNTIME_DIR, rel);
  if (!file.startsWith(RUNTIME_DIR + sep)) return notFound();
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return notFound();
  return new Response(Bun.file(file), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
    },
  });
}

/** The route to add to a Bun.serve routes table. */
export const runtimeRoute = { [`${RUNTIME_PREFIX}*`]: (req: Request) => runtimeFile(new URL(req.url).pathname) };
