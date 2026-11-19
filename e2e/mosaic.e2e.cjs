// End-to-end check of the core claim: Mosaic uses a site it has never seen, with no
// change to Mosaic, and a site's writes run only after the person approves them on
// that site's own prompt. Uses its own ports so it can run beside `bun run dev`.
// Set CHROMIUM_PATH when the installed browser revision differs from playwright-core's.
const { chromium } = require("playwright-core");
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");

const HOST = "http://localhost:5000";
const SITES = { docs: 5101, releases: 5102, announcer: 5103 };
const EVIL_PORT = 5666;
const procs = [];
let browser;

function start(file, port) {
  const p = spawn("bun", [file], { env: { ...process.env, PORT: String(port), MOSAIC_HOSTS: HOST, NODE_ENV: "production" }, stdio: ["ignore", "inherit", "inherit"] });
  procs.push(p);
  return waitFor(`http://localhost:${port}/`);
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not start`);
}

async function connect(page, port) {
  await page.getByLabel("Site URL").fill(`http://localhost:${port}`);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const panel = page.locator(`section.site[data-origin="http://localhost:${port}"]`);
  await panel.locator(".badge.ready").waitFor();
  return panel;
}

function bridgeFrame(page, port) {
  return page.frameLocator(`section.site[data-origin="http://localhost:${port}"] iframe.bridge`);
}

async function main() {
  await Promise.all([start("src/host/server.ts", 5000), start("providers/docs.ts", SITES.docs), start("providers/releases.ts", SITES.releases)]);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(HOST);

  // 1. Two sites become controls.
  const docs = await connect(page, SITES.docs);
  const releases = await connect(page, SITES.releases);
  assert.equal(await docs.locator("form.widget").count(), 2);
  assert.equal(await releases.locator("form.widget").count(), 3);

  // 2. A read runs at once through the bridge.
  const draft = releases.locator('form.widget[data-capability="draft-changelog"]');
  await draft.getByLabel("Highlights (one per line)").fill("First public release\nNew plugin API");
  await draft.getByRole("button", { name: "Draft changelog" }).click();
  await draft.locator(".output").getByText("- New plugin API").waitFor();

  // 3. A write waits for the site's own prompt. Deny first.
  const publish = releases.locator('form.widget[data-capability="publish-release"]');
  await publish.getByLabel("Release notes").fill("First public release.");
  await publish.getByRole("button", { name: "Publish release" }).click();
  const prompt = bridgeFrame(page, SITES.releases);
  await prompt.getByRole("button", { name: "Deny" }).click();
  await publish.locator(".output-error").getByText("the person denied this action").waitFor();
  let home = await (await fetch(`http://localhost:${SITES.releases}/`)).text();
  assert.ok(home.includes("No changes yet."), "a denied write must not reach the site");

  // 4. Approve. The button is disabled for a moment against tricked clicks.
  await publish.getByRole("button", { name: "Publish release" }).click();
  const approve = prompt.getByRole("button", { name: "Approve" });
  await approve.waitFor();
  assert.equal(await approve.isDisabled(), true, "Approve starts disabled");
  await approve.click();
  await publish.locator(".output").getByText("/releases/v1.0").waitFor();
  home = await (await fetch(`http://localhost:${SITES.releases}/`)).text();
  assert.ok(home.includes("publish-release"), "an approved write reaches the site");

  // 5. A site that did not exist when Mosaic loaded: start it now, connect, use it.
  await start("providers/announcer.ts", SITES.announcer);
  const announcer = await connect(page, SITES.announcer);
  const announce = announcer.locator('form.widget[data-capability="draft-announcement"]');
  await announce.getByLabel("Project").fill("Mosaic");
  await announce.getByLabel("Release notes").fill("First public release.");
  await announce.getByLabel("Tone").selectOption("excited");
  await announce.getByRole("button", { name: "Draft announcement" }).click();
  await announce.locator(".output").getByText("Mosaic v1.0 is here!").waitFor();

  // 6. The host page cannot call a site's API directly.
  const direct = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return `status ${r.status}`;
    } catch (e) {
      return "blocked";
    }
  }, `http://localhost:${SITES.releases}/api/capabilities/publish-release`);
  assert.equal(direct, "blocked", "the browser must block a direct cross-origin call");

  // 7. A page on an origin the site does not allow gets a refusal, not a result.
  const evil = http.createServer((_, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<iframe id="f" src="http://localhost:${SITES.releases}/mosaic/bridge"></iframe><script>
      window.result = new Promise((resolve) => addEventListener("message", (e) => resolve(e.data)));
      f.onload = () => f.contentWindow.postMessage({ protocol: "bridge/0", kind: "invoke", id: "x", capability: "publish-release", input: { version: "v6.6.6", notes: "x" } }, "*");
    </script>`);
  });
  await new Promise((r) => evil.listen(EVIL_PORT, r));
  const evilPage = await browser.newPage();
  await evilPage.goto(`http://localhost:${EVIL_PORT}/`);
  const reply = await evilPage.evaluate(() => window.result);
  assert.equal(reply.kind, "refused");
  assert.equal(reply.error.code, "host_not_allowed");
  evil.close();

  await page.screenshot({ path: "e2e/last-run.png", fullPage: true });
  console.log("e2e: all 7 checks passed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    procs.forEach((p) => p.kill());
  });
