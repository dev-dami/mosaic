// End-to-end check of the core claim: Mosaic uses a site it has never seen, with no
// change to Mosaic, and a site's writes run only after the person approves them on
// that site's own prompt. It also checks that one site's output feeds another site's input.
// Uses its own ports so it can run beside `bun run dev`: set E2E_PORT_BASE (default 5000).
// Set CHROMIUM_PATH when the installed browser revision differs from playwright-core's.
const { chromium } = require("playwright-core");
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");

const BASE = Number(process.env.E2E_PORT_BASE ?? 5000);
const HOST = `http://localhost:${BASE}`;
const SITES = { docs: BASE + 101, releases: BASE + 102, announcer: BASE + 103 };
const EVIL_PORT = BASE + 666;
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

const origin = (port) => `http://localhost:${port}`;
/** A capability's block, wherever it sits in the runbook (its step, or Ready to publish). */
const cap = (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`);

async function connect(page, port) {
  await page.getByLabel("Site URL").fill(origin(port));
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator(`.source.ready[data-origin="${origin(port)}"]`).waitFor();
}

function bridgeFrame(page, port) {
  return page.frameLocator(`iframe.bridge[data-origin="${origin(port)}"]`);
}

async function main() {
  await Promise.all([start("src/host/server.ts", BASE), start("providers/docs.ts", SITES.docs), start("providers/releases.ts", SITES.releases)]);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(HOST);
  const build = page.getByTestId("build");
  await build.waitFor();
  const buildBefore = await build.textContent();

  // 1. Two sites become controls: every capability in their manifests is in the runbook.
  await connect(page, SITES.docs);
  await connect(page, SITES.releases);
  assert.equal(await page.locator(`.cap[data-origin="${origin(SITES.docs)}"]`).count(), 2);
  assert.equal(await page.locator(`.cap[data-origin="${origin(SITES.releases)}"]`).count(), 3);

  // 2. A read runs at once through the bridge, and its output is rendered as content.
  const draft = cap(page, SITES.releases, "draft-changelog");
  await draft.getByLabel("Highlights (one per line)").fill("First public release\nNew plugin API");
  await draft.getByRole("button", { name: "Draft changelog" }).click();
  await draft.locator(".output li").getByText("New plugin API").waitFor();

  // 3. A write waits for the site's own prompt. Deny first.
  //    Its notes are bound to the changelog output, and the site's prompt shows that value.
  const publish = cap(page, SITES.releases, "publish-release");
  await publish.locator(`[data-flow-dst="${origin(SITES.releases)}#draft-changelog|notes"]`).waitFor();
  await publish.getByRole("button", { name: "Publish release" }).click();
  const prompt = bridgeFrame(page, SITES.releases);
  await prompt.locator("dd").getByText("New plugin API").waitFor();
  await prompt.getByRole("button", { name: "Deny" }).click();
  await publish.locator(".output-error").getByText("the person denied this action").waitFor();
  let home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("No changes yet."), "a denied write must not reach the site");

  // 4. Approve. The button is disabled for a moment against tricked clicks.
  await publish.getByRole("button", { name: "Publish release" }).click();
  const approve = prompt.getByRole("button", { name: "Approve" });
  await approve.waitFor();
  assert.equal(await approve.isDisabled(), true, "Approve starts disabled");
  await approve.click();
  await publish.locator(".output").getByText("/releases/v1.0").waitFor();
  home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("publish-release"), "an approved write reaches the site");

  // 5. A site that did not exist when Mosaic loaded: start it now, connect, use it.
  await start("providers/announcer.ts", SITES.announcer);
  await connect(page, SITES.announcer);
  await page.getByLabel("Project", { exact: true }).fill("Mosaic");
  const announce = cap(page, SITES.announcer, "draft-announcement");
  await announce.getByRole("radio", { name: "excited" }).check();
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
  }, `${origin(SITES.releases)}/api/capabilities/publish-release`);
  assert.equal(direct, "blocked", "the browser must block a direct cross-origin call");

  // 7. A page on an origin the site does not allow gets a refusal, not a result.
  const evil = http.createServer((_, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<iframe id="f" src="${origin(SITES.releases)}/mosaic/bridge"></iframe><script>
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

  // 8. Data flows across sites: the changelog drafted on Releases is in the post drafted on Announcer.
  await announce.locator(".output li").getByText("New plugin API").waitFor();

  // 9. The flow continues to a third write: the scheduled post takes the drafted text, and the
  //    announcer's own prompt shows it before anything is posted.
  const schedule = cap(page, SITES.announcer, "schedule-announcement");
  await schedule.locator(`[data-flow-dst="${origin(SITES.announcer)}#draft-announcement|text"]`).waitFor();
  await schedule.getByRole("button", { name: "Schedule announcement" }).click();
  const announcerPrompt = bridgeFrame(page, SITES.announcer);
  await announcerPrompt.locator("dd").getByText("Mosaic v1.0 is here!").waitFor();
  await announcerPrompt.getByRole("button", { name: "Approve" }).click();
  await schedule.locator(".output").getByText("/posts/post-1").waitFor();

  // 10. Connecting three sites, one of them new, did not change Mosaic: same source fingerprint.
  assert.equal(await build.textContent(), buildBefore, "Mosaic's build must not change when a site is connected");
  await page.locator(".build.same").waitFor();

  await page.screenshot({ path: "e2e/last-run.png", fullPage: true });
  console.log("e2e: all 10 checks passed");
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
