// The agent turn (card C9): with a BYOK profile, the outcome runs as one turn of Mosaic's own agent
// network (front "mosaic" + internal "composer") in the browser, across the connected sites'
// networks, and the person watches it as Mosaic's runbook. A scripted OpenAI-compatible router
// plays the model, so the turn is the same every time. Checks 23-29:
//   23. with no key, the manual keyword runbook is unchanged and no turn runs;
//   24. the runbook shows mosaic → composer, a peer call to Pagewright with a website_ read whose
//       output is rendered, and a peer call to Tagforge; sites the person connected are not asked
//       about again during the turn;
//   25. Tagforge's write reaches "Open Tagforge to approve", the site's own sheet, then Published,
//       in the runbook, the review dock and the activity log, which names the router host;
//   26. a linked site the person never connected still asks first (declined: a visible problem);
//   27. Stop during a peer's step: "Stopping…" while the runtime drains, no new turn and no manual
//       write meanwhile, and no approval window opens for the stopped turn;
//   28. a write approved before Stop keeps Published and its receipt;
//   29. a router error shows as a plain error in the runbook.
// Called from mosaic.e2e.cjs. Set C9_SCREENSHOT to save a turn in progress.
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const assert = require("node:assert/strict");
const settings = require("./areas/settings.cjs");
const entry = require("./areas/entry.cjs");
const agent = require("./areas/agent.cjs");
const review = require("./areas/review.cjs");

const KEY = "otk_agent789";
const FINAL = "Lumen v1.0 is launched: notes drafted, docs previewed, release published.";
const DRAFT = "Lumen v1.0 is the first public release, with a new plugin API.";

const sse = (res, model, delta) => {
  res.setHeader("content-type", "text/event-stream");
  res.write(`data: ${JSON.stringify({ model, choices: [{ delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};
const call = (name, args, content) => ({ ...(content ? { content } : {}), tool_calls: [{ index: 0, id: `call_${name}_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays every agent of the turn, chosen by the tools it is offered:
 *   mosaic (offered "composer"): composer → pagewright → tagforge → final answer;
 *   composer (no tools): the draft;
 *   Pagewright's front agent (offered website_preview-docs-update): that read, then an answer;
 *   Tagforge's front agent (offered website_publish-release): that write, then an answer.
 * Words in the outcome change the script: "hold" holds Tagforge's first answer, "linger" holds
 * mosaic's final answer, "loudhailer" makes mosaic call only Loudhailer, "break" gets an error.
 */
function scriptedRouter(port, { holdTagforgeMs }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (!(req.method === "POST" && req.url === "/v1/chat/completions")) {
        res.statusCode = 404;
        return res.end("not found");
      }
      const parsed = JSON.parse(body || "{}");
      const tools = (parsed.tools || []).map((t) => t.function.name);
      const messages = parsed.messages || [];
      const lastUser = messages.map((m) => m.role).lastIndexOf("user");
      const user = String(messages[lastUser]?.content ?? "");
      const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
      seen.push({ tools, auth: req.headers.authorization || "" });
      const model = parsed.model;
      if (tools.includes("composer")) {
        if (/break/.test(user)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: { message: "The mock router refused this request." } }));
        }
        if (/loudhailer/.test(user)) return sse(res, model, results === 0 ? call("loudhailer", { request: "Announce Lumen v1.0" }) : { content: "Loudhailer was not used." });
        if (/linger/.test(user) && results === 3) await sleep(5000);
        const hold = /hold/.test(user) ? " (hold)" : "";
        const step = [
          () => call("composer", { request: "Draft the release notes for Lumen v1.0" }, "I'll draft the notes, preview the docs, then publish the release."),
          () => call("pagewright", { request: "Preview the docs update for Lumen v1.0" }),
          () => call("tagforge", { request: `Publish Lumen v1.0 with these notes: ${DRAFT}${hold}` }),
        ][results];
        return sse(res, model, step ? step() : { content: FINAL });
      }
      const read = tools.find((t) => t === "website_preview-docs-update");
      if (read) return sse(res, model, results === 0 ? call(read, { version: "v1.0", summary: DRAFT }) : { content: "The docs preview for v1.0 is ready." });
      const write = tools.find((t) => t === "website_publish-release");
      if (write) {
        if (results === 0) await sleep(/\(hold\)/.test(user) ? 4000 : holdTagforgeMs);
        return sse(res, model, results === 0 ? call(write, { version: "v1.0", notes: DRAFT }) : { content: "Release v1.0 is published." });
      }
      return sse(res, model, { content: DRAFT }); // composer
    });
  });
  return new Promise((r) => server.listen(port, () => r({ server, seen })));
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`${url} did not start`);
}

/** Fails at once when another process holds the port: these checks must talk to their own servers. */
function assertFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`port ${port} is already in use; the agent checks need their own host`)));
    probe.listen(port, () => probe.close(resolve));
  });
}

async function agentChecks({ browser, procs, base, screenshot }) {
  const hostPort = base + 60;
  const docsPort = base + 61;
  const releasesPort = base + 62;
  const announcerPort = base + 63; // linked by the host, never started or connected
  const routerPort = base + 70;
  const host = `http://localhost:${hostPort}`;
  const routerUrl = `http://localhost:${routerPort}/v1`;
  for (const port of [hostPort, docsPort, releasesPort, routerPort]) await assertFree(port);
  const run = (file, port, env) => {
    const p = spawn("bun", [file], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", ...env }, stdio: ["ignore", "ignore", "inherit"] });
    procs.push(p);
    p.once("exit", (code) => code && console.error(`${file} on ${port} exited with ${code}`));
  };
  run("src/host/server.ts", hostPort, { SITE_ORIGINS: `pagewright=http://localhost:${docsPort},tagforge=http://localhost:${releasesPort},loudhailer=http://localhost:${announcerPort}` });
  run("providers/docs.ts", docsPort, { MOSAIC_HOSTS: host });
  run("providers/releases.ts", releasesPort, { MOSAIC_HOSTS: host });
  const { server, seen } = await scriptedRouter(routerPort, { holdTagforgeMs: screenshot ? 2500 : 600 });
  try {
    await Promise.all([host, `http://localhost:${docsPort}`, `http://localhost:${releasesPort}`].map((u) => waitFor(`${u}/`)));
    // The page we test is this host's: it links Loudhailer on our own port.
    assert.ok((await (await fetch(`${host}/links.json`)).text()).includes(`localhost:${announcerPort}`), "the agent checks run against their own host");

    // 23. No key: the manual runbook is today's keyword plan, the outcome says so, and Enter runs no turn.
    const manualCtx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 860 } });
    const manual = await manualCtx.newPage();
    await manual.goto(host);
    await entry.connect(manual, docsPort);
    await agent.modeLine(manual, "manual").waitFor();
    assert.match(await agent.modeLine(manual, "manual").innerText(), /Manual mode\. No key, so Mosaic plans the steps by keyword/);
    assert.ok((await manual.locator(".plan-route .plan-stop").count()) >= 1, "the manual plan lists its steps");
    await agent.submitOutcome(manual);
    await manual.waitForTimeout(500);
    assert.equal(await agent.turn(manual).count(), 0, "no agent turn runs without a key");
    await manualCtx.close();

    // 24. Model mode: save a profile on the scripted router, connect both sites (plain Allow), run the outcome.
    const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    const contactDialogs = [];
    await page.goto(host);
    const panel = await settings.open(page);
    await settings.saveProfile(panel, { router: routerUrl, model: "mock-model-1", key: KEY, name: "Script" });
    await settings.waitInUse(panel, "Script");
    await page.keyboard.press("Escape");
    await entry.connect(page, docsPort);
    await entry.connect(page, releasesPort, "tagforge");
    await agent.modeLine(page, "model").waitFor();
    assert.match(await agent.modeLine(page, "model").innerText(), new RegExp(`mock-model-1 at localhost:${routerPort}`));
    // Count any "Contact <host>?" dialog: connected sites must not raise one.
    await page.exposeFunction("__contactAsked", (name) => contactDialogs.push(name));
    await page.evaluate(() => {
      new MutationObserver(() => {
        for (const d of document.querySelectorAll('[role="dialog"]')) {
          const t = d.querySelector("h2")?.textContent ?? "";
          if (/^Contact /.test(t) && !d.dataset.seen) {
            d.dataset.seen = "1";
            window.__contactAsked(t);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    await agent.submitOutcome(page);
    const turn = agent.turn(page);
    await turn.waitFor();
    assert.equal(await agent.modelLabel(page).innerText(), `Model: mock-model-1 at localhost:${routerPort}`);
    // mosaic → composer is Mosaic's own step.
    await agent.composerStep(page).getByText(`Composer drafted "${DRAFT}"`).waitFor();
    // The peer call to Pagewright, with its website_ read, input and rendered output (a diff).
    const docsStep = agent.peerStep(page, docsPort);
    await docsStep.waitFor();
    assert.match(await docsStep.locator(".provenance").innerText(), new RegExp(`Pagewright\\s*localhost:${docsPort}`));
    const readCard = docsStep.locator('.agent-card[data-action="preview-docs-update"]');
    await readCard.locator(".agent-card-output").waitFor();
    await readCard.locator(".agent-card-input").getByText("v1.0", { exact: true }).waitFor();
    await readCard.locator(".agent-card-output").getByText("plugin API").first().waitFor();
    // The same read's output also fills the runbook's own block for that capability.
    await page.locator(`.cap[data-origin="http://localhost:${docsPort}"][data-capability="preview-docs-update"] .output`).first().waitFor();

    // 25. The peer call to Tagforge reaches its write: the site's own window asks.
    const relStep = agent.peerStep(page, releasesPort);
    await relStep.waitFor();
    if (screenshot) {
      await page.mouse.move(5, 5);
      await page.setViewportSize({ width: 1280, height: 1180 });
      await turn.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => document.querySelector(".doc-scroll")?.scrollBy(0, -64));
      await page.screenshot({ path: screenshot });
    }
    const approveOn = async () => {
      const open = page.getByRole("button", { name: "Open Tagforge to approve" });
      await open.waitFor({ timeout: 15_000 });
      const [sheet] = await Promise.all([page.waitForEvent("popup"), open.click()]);
      await sheet.waitForLoadState("domcontentloaded");
      assert.equal(new URL(sheet.url()).origin, `http://localhost:${releasesPort}`, "the sheet is on the site's own origin");
      await sheet.locator("dd").getByText("plugin API").first().waitFor();
      await sheet.getByRole("button", { name: "Approve" }).click(); // waits out the site's Approve delay
    };
    await approveOn();
    const writeCard = relStep.locator('.agent-card[data-action="publish-release"]');
    await writeCard.getByText("Published", { exact: true }).waitFor();
    await writeCard.locator(".agent-card-output").getByText("/releases/v1.0").waitFor();
    await turn.locator(".agent-summary").getByText(FINAL).waitFor();
    // The dock's card and the activity log keep the receipt; the log names the router host.
    await page.locator(".act-table tr.write.done").getByText("Publish release").waitFor();
    assert.equal(await page.getByTestId("activity-model").innerText(), `Model: mock-model-1 at localhost:${routerPort}`);
    const home = await (await fetch(`http://localhost:${releasesPort}/`)).text();
    assert.ok(home.includes("publish-release"), "the approved write reached the site");
    assert.ok(seen.length >= 7 && seen.every((r) => r.auth === `Bearer ${KEY}`), "every model call carried the key to the router");
    assert.deepEqual(contactDialogs, [], "sites the person connected are not asked about again in a turn");

    // 26. A linked site the person never connected still asks first. Declined: a visible problem, nothing sent.
    await agent.setOutcome(page, "Tell loudhailer about Lumen v1.0");
    await agent.submitOutcome(page);
    const contact = page.getByRole("dialog", { name: `Contact localhost:${announcerPort}?` });
    await contact.waitFor();
    await contact.getByRole("button", { name: "Decline" }).click();
    await turn.locator(".agent-step.problem").getByText(`You declined to contact localhost:${announcerPort}`).waitFor();
    await turn.locator(".agent-summary").waitFor();

    // 27. Stop while Tagforge's agent is mid-step: the turn drains ("Stopping…"), refuses a new turn
    //     and a manual write meanwhile, and its write never opens an approval window.
    const published = async () => {
      const all = page.getByRole("button", { name: /^Show all/ });
      if (await all.count()) await all.click();
      return page.locator(".act-table tr.write.done").count();
    };
    const receiptsBefore = await published();
    await agent.setOutcome(page, "Launch Lumen v1.0 and hold");
    await agent.submitOutcome(page);
    await agent.peerStep(page, releasesPort).waitFor();
    await agent.stopButton(page).click();
    await page.locator(".mode-line").getByText("Stopping…").waitFor();
    await turn.getByText(/^Stopping…/).first().waitFor();
    await agent.submitOutcome(page); // refused while draining
    await review.openDock(page);
    const dockWrite = review.writeCard(page, releasesPort, "publish-release");
    await review.askButton(dockWrite).first().click({ trial: false }).catch(() => {}); // refused while draining
    await page.keyboard.press("Escape");
    const opened = await page.getByRole("button", { name: "Open Tagforge to approve" }).waitFor({ timeout: 6000 }).then(() => true, () => false);
    assert.equal(opened, false, "no approval window opens after Stop");
    await turn.getByText("You stopped this turn").waitFor({ timeout: 15_000 });
    assert.equal(await agent.turn(page).locator(".agent-turn-status").innerText(), "Stopped", "one turn: the refused Enter started none");
    assert.equal(await published(), receiptsBefore, "nothing was published after Stop");

    // 28. A write approved before Stop keeps Published and its receipt.
    await agent.setOutcome(page, "Launch Lumen v1.0 and linger");
    await agent.submitOutcome(page);
    await approveOn();
    const lingerCard = agent.peerStep(page, releasesPort).locator('.agent-card[data-action="publish-release"]');
    await lingerCard.getByText("Published", { exact: true }).waitFor();
    await agent.stopButton(page).click();
    await turn.getByText("You stopped this turn").waitFor({ timeout: 15_000 });
    await lingerCard.getByText("Published", { exact: true }).waitFor();
    assert.equal(await published(), receiptsBefore + 1, "the approved write keeps its receipt");

    // 29. A runtime error shows as a plain error in the runbook.
    await agent.setOutcome(page, "Launch Lumen v1.0 and break");
    await agent.submitOutcome(page);
    const err = page.locator(".agent-turn.failed .agent-error[role=alert]");
    await err.waitFor({ timeout: 15_000 });
    assert.ok((await err.innerText()).trim().length > 0, "the error has words");
    await context.close();
  } finally {
    server.close();
  }
}

module.exports = { agentChecks };
