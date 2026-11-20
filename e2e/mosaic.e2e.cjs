// End-to-end check of the core claim: Mosaic uses a site it has never seen, with no change to
// Mosaic, through the site's published agent network (Open Agentic Web MVP Profile 0.3), and a
// site's writes run only after the person approves them on that site's own sheet, in a window on
// the site's origin. It also checks that one site's output feeds another site's input, that a
// wrong network name is refused, and that a write whose site vanished is "Outcome unknown".
// Uses its own ports so it can run beside `bun run dev`: set E2E_PORT_BASE (default 5000).
// Set CHROMIUM_PATH when the installed browser revision differs from playwright-core's.
// Set C7_SCREENSHOT to a path to save the connected workspace with a published write.
const { chromium } = require("playwright-core");
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");

const BASE = Number(process.env.E2E_PORT_BASE ?? 5000);
const HOST = `http://localhost:${BASE}`;
const SITES = { docs: BASE + 101, releases: BASE + 102, announcer: BASE + 103, newsletter: BASE + 104 };
const EVIL_PORT = BASE + 666;
const procs = [];
let browser;

function start(file, port, env = {}) {
  const p = spawn("bun", [file], { env: { ...process.env, PORT: String(port), MOSAIC_HOSTS: HOST, NODE_ENV: "production", ...env }, stdio: ["ignore", "inherit", "inherit"] });
  procs.push(p);
  return waitFor(`http://localhost:${port}/`).then(() => p);
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
  // The host links the three suggested sites by network name; Inkpost stays unlinked (a spare slot).
  const siteOrigins = `pagewright=${origin(SITES.docs)},tagforge=${origin(SITES.releases)},loudhailer=${origin(SITES.announcer)}`;
  const [, docsProc] = await Promise.all([
    start("src/host/server.ts", BASE, { SITE_ORIGINS: siteOrigins }),
    start("providers/docs.ts", SITES.docs),
    start("providers/releases.ts", SITES.releases),
  ]);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(HOST);
  const build = buildBadge(page);
  await build.waitFor();
  const buildBefore = await build.textContent();

  // 1. A site's published network becomes steps: every bridge action of its network is in the
  //    workspace. The connect trace passed all six checks (consent through build).
  await entry.connect(page, SITES.docs);
  assert.equal(await capabilityCount(page, SITES.docs), 2);
  assert.equal(await page.locator(`.source.ready[data-origin="${origin(SITES.docs)}"]`).count(), 1);

  // 2. A wrong network name fails closed, visibly, and connects nothing.
  const refusal = await entry.connectRefused(page, `${origin(SITES.releases)}/wrongname`);
  assert.match(await refusal.innerText(), /has no network named "wrongname"/);
  assert.match(await refusal.innerText(), /No published network named 'wrongname'/);
  assert.equal(await page.locator(".palette .check.failed").count(), 1, "the trace stops at the network check");
  await entry.closePalette(page);
  assert.equal(await capabilityCount(page, SITES.releases), 0, "a refused network adds nothing");
  // The exact name connects.
  await entry.connect(page, SITES.releases, "tagforge");
  assert.equal(await capabilityCount(page, SITES.releases), 3);

  // 3. A read runs through the site's action bridge, and its output is rendered as content.
  const draft = runbook.readBlock(page, SITES.releases, "draft-changelog");
  await runbook.fillInput(draft, "Highlights (one per line)", "First public release\nNew plugin API");
  await runbook.run(draft, "Draft changelog");
  await runbook.waitOutputItem(draft, "New plugin API");

  // 4. A write waits for the site's own sheet, in a window on the site's origin. Deny first.
  //    Its notes are bound to the changelog output, and the site's sheet shows that value.
  const publish = review.writeCard(page, SITES.releases, "publish-release");
  await review.waitBoundTo(publish, `${origin(SITES.releases)}#draft-changelog|notes`);
  let sheet = await review.start(publish, "Publish release");
  assert.equal(new URL(sheet.url()).origin, origin(SITES.releases), "the sheet is on the site's own origin");
  await review.waitSheetValue(sheet, "New plugin API");
  await review.deny(sheet);
  await review.waitDenied(publish);
  await review.waitTag(publish, "Denied");
  let home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("No changes yet."), "a denied write must not reach the site");

  // 5. Approve. The button is disabled for a moment against tricked clicks. Published, and the
  //    site's own activity log has it.
  sheet = await review.start(publish, "Publish release");
  const approve = review.approveButton(sheet);
  await approve.waitFor();
  assert.equal(await approve.isDisabled(), true, "Approve starts disabled");
  await approve.click();
  await review.waitTag(publish, "Published");
  await review.waitReceipt(publish, "/releases/v1.0");
  home = await (await fetch(`${origin(SITES.releases)}/`)).text();
  assert.ok(home.includes("publish-release"), "an approved write reaches the site");

  // 6. Sites that did not exist when Mosaic loaded: start them now, connect by URL, use them.
  //    Inkpost is not linked in the host's network at all; it binds a spare slot.
  await start("providers/newsletter.ts", SITES.newsletter);
  await entry.connect(page, SITES.newsletter);
  assert.ok((await capabilityCount(page, SITES.newsletter)) > 0, "Inkpost's steps are in the workspace");
  await start("providers/announcer.ts", SITES.announcer);
  await entry.connect(page, SITES.announcer);
  await entry.setDocProp(page, "Project", "Mosaic");
  const announce = runbook.readBlock(page, SITES.announcer, "draft-announcement");
  await runbook.chooseOption(announce, "excited");
  await runbook.run(announce, "Draft announcement");
  await runbook.waitOutput(announce, "Mosaic v1.0 is here!");

  // 7. The host page cannot call a site's API directly.
  const direct = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return `status ${r.status}`;
    } catch (e) {
      return "blocked";
    }
  }, `${origin(SITES.releases)}/api/capabilities/publish-release`);
  assert.equal(direct, "blocked", "the browser must block a direct cross-origin call");

  // 8. A page on an origin the site does not allow gets a refusal, not a result: its action bridge
  //    lists nothing for that caller and refuses to run a write for it.
  const evil = http.createServer((_, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<script>
      window.ask = () => new Promise((resolve) => {
        const bridge = "${origin(SITES.releases)}/bridge/action-bridge.html";
        const w = open(bridge, "_blank", "popup,width=500,height=500");
        addEventListener("message", (e) => {
          if (e.source !== w || e.data?.type !== "ready") return;
          const ch = new MessageChannel();
          const replies = [];
          ch.port1.onmessage = ({ data }) => { replies.push(data); if (replies.length === 2) { w.close(); resolve(replies); } };
          w.postMessage({ protocol: "nsdeploy-actions-v1", type: "connect" }, new URL(bridge).origin, [ch.port2]);
          ch.port1.postMessage({ id: 1, type: "catalog" });
          ch.port1.postMessage({ id: 2, type: "execute", name: "publish-release", args: { version: "v6.6.6", notes: "x" }, requestId: "evil:0" });
        });
      });
    </script>`);
  });
  await new Promise((r) => evil.listen(EVIL_PORT, r));
  const evilPage = await context.newPage();
  await evilPage.goto(`http://localhost:${EVIL_PORT}/`);
  const [catalog, executed] = await evilPage.evaluate(() => window.ask());
  assert.deepEqual(catalog, { id: 1, ok: true, value: [] }, "nothing is listed for another origin");
  assert.equal(executed.ok, false);
  assert.match(executed.error, /not exposed to this caller/);
  await evilPage.close();
  evil.close();

  // 9. Data flows across sites: the changelog drafted on Tagforge is in the post drafted on Loudhailer.
  await runbook.waitOutputItem(announce, "New plugin API");

  // 10. The flow continues to a third write: the scheduled post takes the drafted text, and the
  //     announcer's own sheet shows it before anything is posted.
  const schedule = review.writeCard(page, SITES.announcer, "schedule-announcement");
  await review.waitBoundTo(schedule, `${origin(SITES.announcer)}#draft-announcement|text`);
  const announcerSheet = await review.start(schedule, "Schedule announcement");
  await review.waitSheetValue(announcerSheet, "Mosaic v1.0 is here!");
  await review.approveButton(announcerSheet).click();
  await review.waitReceipt(schedule, "/posts/post-1");
  await review.waitTag(schedule, "Published");

  // 11. Connecting four sites, two of them new, did not change Mosaic: same source fingerprint.
  assert.equal(await build.textContent(), buildBefore, "Mosaic's build must not change when a site is connected");
  await buildSame(page).waitFor();

  // 12. The flow is visible without reading bindings: the changelog's output says which later step
  //     takes it, and a wire joins that output to the inputs it fills (drawn while you point at it).
  await runbook.feedTarget(draft, "Draft announcement").waitFor();
  await runbook.pointAtOutput(draft, "notes");
  await page.waitForFunction(() => document.querySelectorAll("svg.wires .wire.inked").length >= 2);
  assert.ok((await runbook.wires(page).count()) >= 2, "bound inputs are joined to their source by wires");

  await page.screenshot({ path: "e2e/last-run.png", fullPage: true });
  if (process.env.C7_SCREENSHOT) {
    await page.mouse.move(5, 5);
    await review.writeCard(page, SITES.releases, "publish-release").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.C7_SCREENSHOT });
  }

  // 13. The site goes away while its sheet is up: the outcome is unknown, and the card offers no
  //     retry (the site may have done it), only "check the site".
  const apply = review.writeCard(page, SITES.docs, "apply-docs-update");
  const docsSheet = await review.start(apply, "Apply docs update");
  const docsApprove = review.approveButton(docsSheet);
  await docsApprove.waitFor();
  await page.waitForTimeout(800); // past the Approve delay
  docsProc.kill("SIGKILL");
  await new Promise((r) => docsProc.once("exit", r));
  await docsApprove.click();
  await review.waitUnknown(apply);
  await review.waitTag(apply, "Outcome unknown");
  assert.equal(await review.askButton(apply).count(), 0, "an unknown outcome offers no retry");

  // 14-18. AI model settings: BYOK profiles, the key stays out of the page and off every site, and a
  //        turn runs on a local mock router (e2e/settings.e2e.cjs).
  await context.close();
  await require("./settings.e2e.cjs").settingsChecks({ browser, procs, base: BASE, sitePort: SITES.releases, screenshot: process.env.SETTINGS_SCREENSHOT });
  console.log("e2e: all 18 checks passed");
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
