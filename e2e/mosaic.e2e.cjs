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

// Selectors live in e2e/areas/*.cjs, one file per UI area, so a builder who changes an area's
// markup edits only that file. The checks below, and what each one means, stay here.
const { origin, capabilityCount, buildBadge, buildSame } = require("./areas/shell.cjs");
const entry = require("./areas/entry.cjs");
const runbook = require("./areas/runbook.cjs");
const review = require("./areas/review.cjs");

async function main() {
  await Promise.all([start("src/host/server.ts", BASE), start("providers/docs.ts", SITES.docs), start("providers/releases.ts", SITES.releases)]);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(HOST);
  const build = buildBadge(page);
  await build.waitFor();
  const buildBefore = await build.textContent();

  // 1. Two sites become controls: every capability in their manifests is in the workspace.
  await entry.connect(page, SITES.docs);
  await entry.connect(page, SITES.releases);
  assert.equal(await capabilityCount(page, SITES.docs), 2);
  assert.equal(await capabilityCount(page, SITES.releases), 3);

  // 2. A read runs at once through the bridge, and its output is rendered as content.
  const draft = runbook.readBlock(page, SITES.releases, "draft-changelog");
  await runbook.fillInput(draft, "Highlights (one per line)", "First public release\nNew plugin API");
  await runbook.run(draft, "Draft changelog");
  await runbook.waitOutputItem(draft, "New plugin API");

  // 3. A write waits for the site's own prompt. Deny first.
  //    Its notes are bound to the changelog output, and the site's prompt shows that value.
  const publish = review.writeCard(page, SITES.releases, "publish-release");
  await review.waitBoundTo(publish, `${origin(SITES.releases)}#draft-changelog|notes`);
  await review.start(publish, "Publish release");
  const prompt = review.sheet(page, SITES.releases);
  await review.waitSheetValue(prompt, "New plugin API");
  await review.deny(prompt);
  await review.waitDenied(publish);
  let home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("No changes yet."), "a denied write must not reach the site");

  // 4. Approve. The button is disabled for a moment against tricked clicks.
  await review.start(publish, "Publish release");
  const approve = review.approveButton(prompt);
  await approve.waitFor();
  assert.equal(await approve.isDisabled(), true, "Approve starts disabled");
  await approve.click();
  await review.waitReceipt(publish, "/releases/v1.0");
  home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("publish-release"), "an approved write reaches the site");

  // 5. A site that did not exist when Mosaic loaded: start it now, connect, use it.
  await start("providers/announcer.ts", SITES.announcer);
  await entry.connect(page, SITES.announcer);
  await entry.setDocProp(page, "Project", "Mosaic");
  const announce = runbook.readBlock(page, SITES.announcer, "draft-announcement");
  await runbook.chooseOption(announce, "excited");
  await runbook.run(announce, "Draft announcement");
  await runbook.waitOutput(announce, "Mosaic v1.0 is here!");

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
  await runbook.waitOutputItem(announce, "New plugin API");

  // 9. The flow continues to a third write: the scheduled post takes the drafted text, and the
  //    announcer's own prompt shows it before anything is posted.
  const schedule = review.writeCard(page, SITES.announcer, "schedule-announcement");
  await review.waitBoundTo(schedule, `${origin(SITES.announcer)}#draft-announcement|text`);
  await review.start(schedule, "Schedule announcement");
  const announcerPrompt = review.sheet(page, SITES.announcer);
  await review.waitSheetValue(announcerPrompt, "Mosaic v1.0 is here!");
  await review.approveButton(announcerPrompt).click();
  await review.waitReceipt(schedule, "/posts/post-1");

  // 10. Connecting three sites, one of them new, did not change Mosaic: same source fingerprint.
  assert.equal(await build.textContent(), buildBefore, "Mosaic's build must not change when a site is connected");
  await buildSame(page).waitFor();

  // 11. The flow is visible without reading bindings: the changelog's output says which later step
  //     takes it, and a wire joins that output to the inputs it fills (drawn while you point at it).
  await runbook.feedTarget(draft, "Draft announcement").waitFor();
  await runbook.pointAtOutput(draft, "notes");
  await page.waitForFunction(() => document.querySelectorAll("svg.wires .wire.inked").length >= 2);
  assert.ok((await runbook.wires(page).count()) >= 2, "bound inputs are joined to their source by wires");

  await page.screenshot({ path: "e2e/last-run.png", fullPage: true });
  console.log("e2e: all 11 checks passed");
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
