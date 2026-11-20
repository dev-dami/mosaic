// The deploy build (Vercel's buildCommand; locally `bun run build:deploy`). It prebuilds every
// asset a server would otherwise build or read at run time (the host page, the bridge actions
// module, the bridge page and the vendored runtime), then bundles src/roles.ts with those assets
// inside into one file, dist-server/server.js. Root server.ts runs that file in production. It
// needs no sources, no node_modules and no vendor folder, so file tracing cannot miss anything.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";
import { sourceFingerprint } from "../src/host/fingerprint";
import type { Prebuilt } from "../src/prebuilt";
import { RUNTIME_DIR, runtimeFileNames } from "../src/runtime-files";

const root = resolve(import.meta.dir, "..");
const TEXT = /^(text\/|application\/(javascript|json))/;

function built(result: Awaited<ReturnType<typeof Bun.build>>, what: string) {
  if (!result.success) throw new AggregateError(result.logs, `${what} did not build`);
  return result.outputs;
}

/** src/host/index.html built for the browser, by the URL path each file is served at. */
async function hostPage(): Promise<Prebuilt["host"]> {
  const out = mkdtempSync(join(tmpdir(), "mosaic-host-"));
  try {
    const outputs = built(
      await Bun.build({
        entrypoints: [join(root, "src/host/index.html")],
        outdir: out,
        minify: true,
        // React's production build: no dev-only checks, no jsxDEV.
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        jsx: { development: false },
      }),
      "the host page",
    );
    const files: Prebuilt["host"] = {};
    for (const o of outputs) {
      const path = relative(out, o.path).split("\\").join("/");
      const text = TEXT.test(o.type);
      files[path === "index.html" ? "/" : `/${path}`] = text
        ? { type: o.type, body: await o.text() }
        : { type: o.type, body: Buffer.from(await o.arrayBuffer()).toString("base64"), base64: true };
    }
    if (!files["/"]) throw new Error("the host build made no index.html");
    return files;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export async function prebuild(): Promise<Prebuilt> {
  const [actions] = built(
    await Bun.build({ entrypoints: [join(root, "providers/bridge-actions.ts")], target: "browser", format: "esm", minify: true }),
    "providers/bridge-actions.ts",
  );
  const runtime: Prebuilt["runtime"] = {};
  for (const name of runtimeFileNames()) runtime[name] = await Bun.file(join(RUNTIME_DIR, name)).text();
  return {
    fingerprint: await sourceFingerprint(),
    host: await hostPage(),
    bridgePage: await Bun.file(join(root, "providers/bridge-page.html")).text(),
    bridgeActions: await actions!.text(),
    runtime,
  };
}

/** Swaps src/prebuilt.ts for the generated assets, and drops the source-only HTML import. */
function deployAssets(assets: Prebuilt): BunPlugin {
  return {
    name: "mosaic-deploy-assets",
    setup(build) {
      build.onLoad({ filter: /[\\/]src[\\/]prebuilt\.ts$/ }, () => ({
        contents: `export const prebuilt = ${JSON.stringify(assets)};`,
        loader: "js",
      }));
      build.onLoad({ filter: /[\\/]src[\\/]host[\\/]dev-homepage\.ts$/ }, () => ({ contents: "export default undefined;", loader: "js" }));
    },
  };
}

export async function buildDeploy({ outDir = join(root, "dist-server") }: { outDir?: string } = {}): Promise<string> {
  const assets = await prebuild();
  const [server] = built(
    await Bun.build({
      entrypoints: [join(root, "src/roles.ts")],
      target: "bun",
      format: "esm",
      minify: { syntax: true, whitespace: true },
      plugins: [deployAssets(assets)],
    }),
    "the deploy bundle",
  );
  const file = join(outDir, "server.js");
  await Bun.write(file, await server!.text());
  return file;
}

if (import.meta.main) {
  const started = performance.now();
  const file = await buildDeploy();
  console.log(`deploy bundle: ${relative(root, file)} (${(Bun.file(file).size / 1e6).toFixed(1)} MB, ${Math.round(performance.now() - started)} ms)`);
}
