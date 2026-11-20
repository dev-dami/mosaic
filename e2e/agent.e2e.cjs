// The agent turn (card C9): with a BYOK profile, the outcome runs as one turn of Mosaic's own agent
// network (front "mosaic" + internal "composer") in the browser, across the connected sites'
// networks, and the person watches it as Mosaic's runbook. A scripted OpenAI-compatible router
// plays the model, so the turn is the same every time. Checks:
//   - the runbook shows mosaic → composer, a peer call to Pagewright with a website_ read whose
//     output is rendered, and a peer call to Tagforge;
//   - the router host is shown ("Model: … at localhost:<port>");
//   - Tagforge's write reaches "Open Tagforge to approve", the site's own sheet, then Published,
//     in the runbook, the review dock and the activity log;
//   - Stop ends a running turn visibly; a router error shows as a plain error in the runbook;
//   - with no key, the manual keyword runbook is unchanged and no turn runs.
// Called from mosaic.e2e.cjs. Set C9_SCREENSHOT to save a turn in progress.
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");
const settings = require("./areas/settings.cjs");
const entry = require("./areas/entry.cjs");
const agent = require("./areas/agent.cjs");

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

/**
 * Plays every agent of the turn, chosen by the tools it is offered:
 *   mosaic (offered "composer"): composer → pagewright → tagforge → final answer;
 *   composer (no tools): the draft;
 *   Pagewright's front agent (offered website_preview-docs-update): that read, then an answer;
 *   Tagforge's front agent (offered website_publish-release): that write, then an answer.
 * An outcome containing "slowly" holds mosaic's first answer; one containing "break" gets an error.
 */
function scriptedRouter(port, { holdTagforgeMs = 0 } = {}) {
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
        if (/slowly/.test(user) && results === 0) await new Promise((r) => setTimeout(r, 4000));
        const peers = tools.filter((t) => t !== "composer");
        const step = [
          () => call("composer", { request: "Draft the release notes for Lumen v1.0" }, "I'll draft the notes, preview the docs, then publish the release."),
          () => call(peers.find((t) => t === "pagewright"), { request: "Preview the docs update for Lumen v1.0" }),
          () => call(peers.find((t) => t === "tagforge"), { request: `Publish Lumen v1.0 with these notes: ${DRAFT}` }),
        ][results];
        return sse(res, model, step ? step() : { content: FINAL });
      }
      const read = tools.find((t) => t === "website_preview-docs-update");
      if (read) return sse(res, model, results === 0 ? call(read, { version: "v1.0", summary: DRAFT }) : { content: "The docs preview for v1.0 is ready." });
      const write = tools.find((t) => t === "website_publish-release");
      if (write) {
        if (results === 0 && holdTagforgeMs) await new Promise((r) => setTimeout(r, holdTagforgeMs));
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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not start`);
}

async function agentChecks({ browser, procs, base, screenshot }) {
  const hostPort = base + 40;
  const docsPort = base + 41;
  const releasesPort = base + 42;
  const routerPort = base + 50;
  const host = `http://localhost:${hostPort}`;
  const routerUrl = `http://localhost:${routerPort}/v1`;
  const run = (file, port, env) => {
    const p = spawn("bun", [file], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", ...env }, stdio: ["ignore", "ignore", "inherit"] });
    procs.push(p);
  };
  run("src/host/server.ts", hostPort, { SITE_ORIGINS: `pagewright=http://localhost:${docsPort},tagforge=http://localhost:${releasesPort}` });
  run("providers/docs.ts", docsPort, { MOSAIC_HOSTS: host });
  run("providers/releases.ts", releasesPort, { MOSAIC_HOSTS: host });
  const { server, seen } = await scriptedRouter(routerPort, { holdTagforgeMs: screenshot ? 2500 : 600 });
  try {
    await Promise.all([host, `http://localhost:${docsPort}`, `http://localhost:${releasesPort}`].map((u) => waitFor(`${u}/`)));

    // 19. No key: the manual runbook is today's keyword plan, the outcome says so, and Enter runs no turn.
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

    // 20. Model mode: save a profile on the scripted router, connect both sites, run the outcome.
    const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(host);
    const panel = await settings.open(page);
    await settings.saveProfile(panel, { router: routerUrl, model: "mock-model-1", key: KEY, name: "Script" });
    await settings.waitInUse(panel, "Script");
    await page.keyboard.press("Escape");
    await entry.connect(page, docsPort);
    await entry.connect(page, releasesPort, "tagforge");
    await agent.modeLine(page, "model").waitFor();
    assert.match(await agent.modeLine(page, "model").innerText(), new RegExp(`mock-model-1 at localhost:${routerPort}`));

    await agent.submitOutcome(page);
    await agent.allowContacts(page, 2);
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
    await readCard.locator(".agent-card-output .diff, .agent-card-output").getByText("plugin API").first().waitFor();
    // The same read's output also fills the runbook's own block for that capability.
    await page.locator(`.cap[data-origin="http://localhost:${docsPort}"][data-capability="preview-docs-update"] .output`).first().waitFor();

    // The peer call to Tagforge reaches its write: the site's own window asks.
    const relStep = agent.peerStep(page, releasesPort);
    await relStep.waitFor();
    if (screenshot) {
      await page.mouse.move(5, 5);
      await page.setViewportSize({ width: 1280, height: 1180 });
      await turn.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => document.querySelector(".doc-scroll")?.scrollBy(0, -64));
      await page.screenshot({ path: screenshot });
    }
    const open = page.getByRole("button", { name: "Open Tagforge to approve" });
    await open.waitFor({ timeout: 15_000 });
    const [sheet] = await Promise.all([page.waitForEvent("popup"), open.click()]);
    await sheet.waitForLoadState("domcontentloaded");
    assert.equal(new URL(sheet.url()).origin, `http://localhost:${releasesPort}`, "the sheet is on the site's own origin");
    await sheet.locator("dd").getByText("plugin API").first().waitFor();
    const approve = sheet.getByRole("button", { name: "Approve" });
    await approve.click(); // waits out the site's Approve delay
    const writeCard = relStep.locator('.agent-card[data-action="publish-release"]');
    await writeCard.getByText("Published", { exact: true }).waitFor();
    await writeCard.locator(".agent-card-output").getByText("/releases/v1.0").waitFor();
    await turn.locator(".agent-summary").getByText(FINAL).waitFor();
    // The dock's card and the activity log keep the receipt.
    await page.locator(".act-table tr.write.done").getByText("Publish release").waitFor();
    const home = await (await fetch(`http://localhost:${releasesPort}/`)).text();
    assert.ok(home.includes("publish-release"), "the approved write reached the site");
    // The key reached only the router.
    assert.ok(seen.length >= 7 && seen.every((r) => r.auth === `Bearer ${KEY}`), "every model call carried the key to the router");

    // 21. Stop ends a running turn, visibly; nothing more runs for it.
    await agent.setOutcome(page, "Launch Lumen v1.0 slowly");
    await agent.submitOutcome(page);
    await agent.stopButton(page).click();
    await page.locator(".agent-turn.stopped").getByText("You stopped this turn").waitFor();

    // 22. A runtime error shows as a plain error in the runbook.
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
