// Scout's guard for a public deployment: which targets it may open (SCOUT_TARGETS), that its
// browser stays on the target even through redirects, and the limits that keep one caller from
// exhausting the box (body size, one learn at a time, a cap on served adapters).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { observe } from "../agent/observe";
import { startScout } from "../agent/scout";
import { runSkill, step, type Adapter, type Skill } from "../agent/skill";
import { targetPolicy } from "../agent/targets";
import { corkboardFetch } from "../providers/corkboard";

const HOST = "http://localhost:4000";

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const found = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  return found.map((d) => join(cache, d, "chrome-linux64", "chrome")).find((p) => existsSync(p));
}

describe("targetPolicy", () => {
  test("with SCOUT_TARGETS, only the listed origins", () => {
    const allow = targetPolicy("http://localhost:4109, https://corkboard.example");
    expect(allow("http://localhost:4109/thread/1")).toBeNull();
    expect(allow("https://corkboard.example/")).toBeNull();
    expect(allow("http://localhost:4110/")).toMatch(/not in SCOUT_TARGETS/);
    expect(allow("http://127.0.0.2:4109/")).toMatch(/not in SCOUT_TARGETS/);
    expect(allow("http://169.254.169.254/latest/meta-data/")).toMatch(/not in SCOUT_TARGETS/);
    expect(allow("http://corkboard.example/")).toMatch(/not in SCOUT_TARGETS/);
    expect(allow("file:///etc/passwd")).toMatch(/http and https sites only/);
    expect(allow("not a url")).toMatch(/not a URL/);
  });

  test("without SCOUT_TARGETS, loopback only, any port", () => {
    const allow = targetPolicy(undefined);
    for (const ok of ["http://localhost:4109/", "http://127.0.0.1:1/", "http://[::1]:8080/", "https://localhost/"]) expect(allow(ok), ok).toBeNull();
    for (const no of ["http://127.0.0.2/", "http://10.0.0.1/", "http://169.254.169.254/", "https://example.com/"]) expect(allow(no), no).toMatch(/not a loopback address/);
    expect(allow("javascript:alert(1)")).toMatch(/http and https sites only/);
  });
});

let browser: Browser;
let cork: ReturnType<typeof Bun.serve>;
let target: string;
/** An off-target server that counts every request it gets. */
let outside: ReturnType<typeof Bun.serve>;
let outsideHits: string[] = [];
/** An on-target site whose links and pages redirect off target. */
let redirector: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: chromiumPath() });
  cork = Bun.serve({ port: 0, fetch: corkboardFetch });
  target = `http://localhost:${cork.port}`;
  outside = Bun.serve({
    port: 0,
    fetch: (req) => {
      outsideHits.push(new URL(req.url).pathname);
      return new Response("<h1>secret</h1>", { headers: { "content-type": "text/html" } });
    },
  });
  const off = `http://127.0.0.1:${outside.port}`;
  redirector = Bun.serve({
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/away") return Response.redirect(`${off}/away`, 302);
      if (path === "/hop") return Response.redirect("/hop2", 302); // an on-target hop first
      if (path === "/hop2") return Response.redirect(`${off}/hop2`, 302);
      if (path === "/gone") return Response.redirect(`${off}/gone`, 302);
      const html = `<title>Home · Redirector</title><h1>Home</h1><main><ul><li><a href="/away">away</a></li><li><a href="/hop">hop</a></li><li>x</li></ul></main><img src="${off}/pixel.png">`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  for (const s of [cork, outside, redirector]) s?.stop(true);
});

describe("the browser stays on the target", () => {
  test("observe does not follow links or images that redirect or point off target", async () => {
    outsideHits = [];
    const obs = await observe(browser, `http://localhost:${redirector.port}/`);
    expect(obs.pages.map((p) => p.path)).toEqual(["/"]);
    expect(outsideHits).toEqual([]);
  }, 20_000);

  test("observe of a start page that redirects off target opens nothing", async () => {
    outsideHits = [];
    await expect(observe(browser, `http://localhost:${redirector.port}/gone`)).rejects.toThrow(/could not open any page/);
    expect(outsideHits).toEqual([]);
  }, 20_000);

  test("a skill whose page redirects off target stops before the request leaves", async () => {
    outsideHits = [];
    const hop: Skill = { id: "hop", title: "Hop", description: "Follows a redirect.", side_effects: "read", fields: [], steps: [step({ op: "goto", url: "/hop" }), step({ op: "extract", field: "where", kind: "url" })] };
    await expect(runSkill(browser, `http://localhost:${redirector.port}`, hop, {})).rejects.toThrow(/step 1/);
    expect(outsideHits).toEqual([]);
  }, 20_000);
});

describe("Scout's HTTP guard", () => {
  let scout: ReturnType<typeof startScout>;
  let dir: string;
  const adapterBase = 20_000 + Math.floor(Math.random() * 20_000);
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${scout.url}${path}`, { method: "POST", headers: { origin: HOST, "content-type": "application/json", ...headers }, body });
  const adapterFor = (origin: string): Adapter => ({
    mosaic: "adapter/0",
    target: { origin, name: `Site ${origin}` },
    learned: { by: "rules", at: new Date().toISOString() },
    skills: [{ id: "read-home", title: "Read home", description: "Reads the home page heading.", side_effects: "read", fields: [], steps: [step({ op: "goto", url: "/" }), step({ op: "extract", field: "h1", selector: "h1", kind: "text" })] }],
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scout-guard-"));
    scout = startScout({
      port: 0,
      hosts: [HOST],
      dir,
      targets: `${target},http://localhost:1,http://localhost:2`,
      adapterBase,
      adapterOrigin: "https://scout-{port}.203-0-113-10.sslip.io",
      maxAdapters: 2,
      learner: "rules",
      browser: async () => browser,
    });
  });

  afterAll(() => {
    scout?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a learn of a target outside SCOUT_TARGETS is refused with 403", async () => {
    for (const url of ["http://127.0.0.2:4109/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd"]) {
      const res = await post("/learn", JSON.stringify({ url }));
      expect(res.status, url).toBe(403);
      expect((await res.json()).error, url).toMatch(/SCOUT_TARGETS|http and https sites only/);
    }
  });

  test("an allowed target learns, and a second learn while one runs gets 429", async () => {
    const [a, b] = await Promise.all([post("/learn", JSON.stringify({ url: target })), post("/learn", JSON.stringify({ url: target }))]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    const ok = (a.status === 200 ? a : b).json() as Promise<{ target: string; origin: string }>;
    const busy = (a.status === 429 ? a : b).json() as Promise<{ error: string }>;
    expect((await busy).error).toMatch(/one site at a time/);
    const summary = await ok;
    expect(summary.target).toBe(target);
    expect(summary.origin).toBe(`https://scout-${adapterBase}.203-0-113-10.sslip.io`);
  }, 60_000);

  test("an adapter import whose target is outside SCOUT_TARGETS is refused with 403", async () => {
    const res = await post("/templates", JSON.stringify(adapterFor("http://127.0.0.2:4109")));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not in SCOUT_TARGETS/);
  });

  test("a body over 256 KB gets 413", async () => {
    const big = JSON.stringify({ url: target, pad: "x".repeat(300 * 1024) });
    expect((await post("/learn", big)).status).toBe(413);
    expect((await post("/templates", big)).status).toBe(413);
  });

  test("served adapters are capped; the oldest is unloaded", async () => {
    for (const o of ["http://localhost:1", "http://localhost:2"]) expect((await post("/templates", JSON.stringify(adapterFor(o)))).status).toBe(200);
    const list = (await (await fetch(`${scout.url}/templates`, { headers: { origin: HOST } })).json()) as { target: string; origin: string }[];
    expect(list.map((s) => s.target)).toEqual(["http://localhost:1", "http://localhost:2"]);
    for (const s of list) expect(Number(new URL(s.origin).hostname.match(/scout-(\d+)/)![1])).toBeLessThan(adapterBase + 2);
  });
});
