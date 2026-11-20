// The production asset path: scripts/build-deploy.ts bundles every role into one self-contained
// server file, and that file alone (no sources, no node_modules, no vendor folder) serves each role.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeploy } from "../scripts/build-deploy";
import { hostCsp } from "../src/host/csp";
import { sourceFingerprint } from "../src/host/fingerprint";

describe("host content security policy", () => {
  const csp = hostCsp({ siteOrigins: ["https://docs.example", "https://releases.example"], agent: "https://scout.example", extra: ["https://*.scout.example"] });
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

  test("scripts come from the host only", () => {
    expect(directive("script-src")).toBe("script-src 'self'");
  });

  test("frames and fetches reach the listed origins and any https origin, never http wildcards", () => {
    for (const name of ["frame-src", "connect-src"]) {
      const d = directive(name);
      for (const o of ["'self'", "https://docs.example", "https://releases.example", "https://scout.example", "https://*.scout.example", "https://api.otari.ai"]) expect(d).toContain(o);
      expect(d).not.toContain("*.example ");
      expect(d.split(" ")).not.toContain("*");
      expect(d.split(" ")).toContain("https:");
      expect(d.split(" ")).not.toContain("http:");
    }
  });
});

describe("deploy build", () => {
  // Only what a deployment ships: the bundle, run from an empty folder.
  const ship = mkdtempSync(join(tmpdir(), "mosaic-ship-"));
  const procs: ReturnType<typeof Bun.spawn>[] = [];
  const base = 7950 + Math.floor(Math.random() * 30);
  const HOST = `http://localhost:${base}`;
  const DOCS = `http://localhost:${base + 1}`;
  const CORK = `http://localhost:${base + 2}`;

  async function start(role: string, port: number, env: Record<string, string> = {}) {
    const p = Bun.spawn(["bun", join(ship, "server.js")], {
      cwd: ship,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", MOSAIC_ROLE: role, PORT: String(port), NODE_ENV: "production", ...env },
      stdout: "ignore",
      stderr: "inherit",
    });
    procs.push(p);
    for (let i = 0; i < 100; i++) {
      if (await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false)) return;
      await Bun.sleep(100);
    }
    throw new Error(`${role} did not start`);
  }

  beforeAll(async () => {
    await buildDeploy({ outDir: ship });
    await start("host", base, { SITE_ORIGINS: `pagewright=${DOCS}`, MOSAIC_SUGGEST: DOCS });
    await start("docs", base + 1, { PUBLIC_ORIGIN: DOCS, MOSAIC_HOSTS: HOST });
    await start("corkboard", base + 2);
  }, 120_000);
  afterAll(() => {
    for (const p of procs) p.kill();
    rmSync(ship, { recursive: true, force: true });
  });

  test("ships one server file", () => {
    expect(readdirSync(ship)).toEqual(["server.js"]);
  });

  test("the host serves its prebuilt page with a strict policy, and every asset it names", async () => {
    const res = await fetch(`${HOST}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(DOCS);
    const html = await res.text();
    const assets = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]!);
    expect(assets.some((a) => a.endsWith(".js"))).toBe(true);
    for (const a of assets) expect((await fetch(`${HOST}/${a}`)).status).toBe(200);
  });

  test("the host reports the same source fingerprint as the dev server", async () => {
    const info = await (await fetch(`${HOST}/mosaic-host.json`)).json();
    expect(info.build).toBe(await sourceFingerprint());
    expect(info.suggestions).toEqual([DOCS]);
  });

  test("public agent files and the runtime allow any origin; host and bridge settings do not", async () => {
    for (const url of [`${HOST}/agent-manifest.json`, `${HOST}/runtime/engine.js`, `${DOCS}/agent-manifest.json`, `${DOCS}/runtime/engine.js`]) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    for (const url of [`${HOST}/mosaic-host.json`, `${DOCS}/bridge/bridge-config.json`, `${DOCS}/bridge/action-bridge.html`, `${DOCS}/bridge/bridge-actions.js`]) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect((await fetch(`${DOCS}/runtime/nope.js`)).status).toBe(404);
    expect((await fetch(`${DOCS}/runtime/VENDOR.md`)).status).toBe(404);
  });

  test("a site serves its bridge page framable by the host, without COOP, and the actions module", async () => {
    const page = await fetch(`${DOCS}/bridge/action-bridge.html`);
    expect(page.headers.get("content-security-policy")).toBe(`frame-ancestors ${HOST}`);
    expect(page.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(await page.text()).toContain("<html");
    const actions = await fetch(`${DOCS}/bridge/bridge-actions.js`);
    expect(actions.headers.get("content-type")).toContain("javascript");
    expect((await actions.text()).length).toBeGreaterThan(1000);
  });

  test("corkboard is a role of its own", async () => {
    expect(await (await fetch(`${CORK}/`)).text()).toContain("Corkboard");
    // It publishes no manifest: the path is just another HTML page.
    expect((await fetch(`${CORK}/agent-manifest.json`)).headers.get("content-type")).toContain("text/html");
  });
});
