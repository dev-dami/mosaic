// Recipes (card C11): a workspace with two sites becomes one recipe/1 link; opening it in a fresh
// browser context sets the same outcome and connects the same sites, each through its own consent
// dialog (a recipe grants nothing). The link carries no key, router, model, input values or
// results, even after a BYOK profile was saved and a step ran. A bad link gets a plain refusal.
// Called from mosaic.e2e.cjs; uses its own host and site ports (base + 40, + 141, + 142).
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const entry = require("./areas/entry.cjs");
const runbook = require("./areas/runbook.cjs");
const settings = require("./areas/settings.cjs");
const { origin, capabilityCount } = require("./areas/shell.cjs");

const KEY = "otk_recipe789";
const INPUT = "RecipeSecretHighlight";
const OUTCOME = "Ship Lumen v2 from a recipe";

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not start`);
}

async function recipeChecks({ browser, procs, base }) {
  const host = `http://localhost:${base + 40}`;
  const docs = base + 141;
  const releases = base + 142;
  const routerUrl = `http://localhost:${base + 31}/v1`;
  const start = (file, port, env) => {
    procs.push(spawn("bun", [file], { env: { ...process.env, PORT: String(port), MOSAIC_HOSTS: host, NODE_ENV: "production", ...env }, stdio: ["ignore", "ignore", "inherit"] }));
    return waitFor(`http://localhost:${port}/`);
  };
  await Promise.all([
    start("src/host/server.ts", base + 40, { SITE_ORIGINS: `pagewright=${origin(docs)},tagforge=${origin(releases)}` }),
    start("providers/docs.ts", docs),
    start("providers/releases.ts", releases),
  ]);

  // 19. Build a workspace: a saved BYOK profile, two sites, an outcome, a step that ran with an input.
  const a = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await a.grantPermissions(["clipboard-read", "clipboard-write"], { origin: host });
  const page = await a.newPage();
  await page.goto(host);
  const panel = await settings.open(page);
  await settings.saveProfile(panel, { router: routerUrl, model: "recipe-model-x", key: KEY, name: "RecipeProfile" });
  await settings.waitInUse(panel, "RecipeProfile");
  await page.keyboard.press("Escape");
  await entry.connect(page, docs);
  await entry.connect(page, releases, "tagforge");
  await page.locator("#outcome").fill(OUTCOME);
  const draft = runbook.readBlock(page, releases, "draft-changelog");
  await runbook.fillInput(draft, "Highlights (one per line)", INPUT);
  await runbook.run(draft, "Draft changelog");
  await runbook.waitOutputItem(draft, INPUT);

  // Copy the recipe link from the palette.
  await page.getByRole("button", { name: "Search or connect a site" }).click();
  await page.getByLabel("Site URL or search").fill("copy recipe");
  await page.locator(".palette-item", { hasText: "Copy recipe link" }).click();
  await page.locator(".palette-item", { hasText: "Recipe link copied" }).waitFor();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await a.close();

  // 20. The link is recipe/1 and carries only the outcome and the network URLs.
  assert.ok(link.startsWith(`${host}/#recipe=`), link);
  const decoded = Buffer.from(link.split("#recipe=")[1], "base64url").toString("utf8");
  assert.deepEqual(JSON.parse(decoded), { mosaic: "recipe/1", outcome: OUTCOME, networks: [`${origin(docs)}/pagewright`, `${origin(releases)}/tagforge`] });
  for (const secret of [KEY, routerUrl, `localhost:${base + 31}`, "recipe-model-x", "RecipeProfile", INPUT]) {
    assert.ok(!link.includes(secret) && !decoded.includes(secret), `the recipe link carries ${secret}`);
  }

  // 21. A fresh context opens the link: one consent dialog per origin, in order; then the same
  //     outcome and the same sites are back.
  const b = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const fresh = await b.newPage();
  await fresh.goto(link);
  for (const port of [docs, releases]) {
    const consent = fresh.getByRole("dialog", { name: `Connect ${new URL(origin(port)).host}?` });
    await consent.waitFor();
    await consent.getByRole("button", { name: "Allow", exact: true }).click();
    await fresh.locator(`.source.ready[data-origin="${origin(port)}"]`).waitFor();
  }
  assert.equal(await fresh.locator("#outcome").inputValue(), OUTCOME);
  assert.equal(await capabilityCount(fresh, docs), 2);
  assert.equal(await capabilityCount(fresh, releases), 3);
  assert.equal(new URL(fresh.url()).hash, "", "the recipe leaves the address once read");

  // 22. A bad link (a javascript: site) is refused plainly and connects nothing.
  const bad = Buffer.from(JSON.stringify({ mosaic: "recipe/1", outcome: "x", networks: ["javascript:alert(1)//x"] })).toString("base64url");
  const other = await b.newPage();
  await other.goto(`${host}/#recipe=${bad}`);
  const alert = other.locator(".recipe-problem[role=alert]");
  await alert.waitFor();
  assert.match(await alert.innerText(), /Sites must be http or https URLs/);
  assert.equal(await other.getByRole("dialog", { name: /^Connect / }).count(), 0, "a bad recipe asks to connect nothing");
  await b.close();
}

module.exports = { recipeChecks };
