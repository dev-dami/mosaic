// MVP Profile 0.3 §6 in the browser (card C12): the four stops of check 7 and the declined consent
// of check 4, each a visible row in the agent runbook. The host links the fixture networks
// (providers/fixtures/, test only) and a scripted router plays the model. Checks 31-35:
//   31. §6.4 a declined contact: "You declined to contact <host>", and nothing reached that origin;
//   32. §6.7 an invalid network: the runtime's "failed validation" error;
//   33. §6.7 a composition cycle cycle_a ↔ cycle_b: "Skipped: already visited in this request (a cycle)";
//   34. §6.7 an over-budget request (nine peer networks, budget 8): the per-query limit;
//   35. §6.7 a denied origin (outside the peer's allowed_peers): the runtime's policy refusal.
// Called from mosaic.e2e.cjs with its own ports (base + 80 to base + 85).
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");
const settings = require("./areas/settings.cjs");
const agent = require("./areas/agent.cjs");
const entry = require("./areas/entry.cjs");
const interop = require("./areas/interop.cjs");

const KEY = "otk_interop_e2e";
const FAN_OUT = Array.from({ length: 9 }, (_, i) => `fan_${i + 1}`);

const sse = (res, model, delta) => {
  res.setHeader("content-type", "text/event-stream");
  res.write(`data: ${JSON.stringify({ model, choices: [{ delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};
const call = (name, args) => ({ tool_calls: [{ index: 0, id: `call_${name}_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

/** Mosaic's front agent calls what the outcome names; each fixture agent calls on what its network names. */
function scriptedRouter(port) {
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const tools = (parsed.tools || []).map((t) => t.function.name);
      const messages = parsed.messages || [];
      const lastUser = messages.map((m) => m.role).lastIndexOf("user");
      const user = String(messages[lastUser]?.content ?? "");
      const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
      const model = parsed.model;
      if (tools.includes("composer")) {
        const once = (name) => sse(res, model, results === 0 ? call(name, { request: user }) : { content: "Done." });
        if (/decline/.test(user)) return once("echo");
        if (/invalid/.test(user)) return once("broken");
        if (/cycle/.test(user)) return once("cycle_a");
        if (/denied/.test(user)) return once("stray");
        if (/budget/.test(user)) return sse(res, model, results < FAN_OUT.length ? call(FAN_OUT[results], { request: user }) : { content: "Done." });
        return sse(res, model, { content: "Nothing to do." });
      }
      const onward = tools.find((t) => ["cycle_a", "cycle_b", "anything"].includes(t));
      if (onward && results === 0) return sse(res, model, call(onward, { request: user }));
      return sse(res, model, { content: "Answered." });
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
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

/** Waits for `target`, allowing any contact dialog on the way ("Always allow" its host). */
async function untilVisible(page, target, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await target.count()) return;
    const dialog = interop.anyContactDialog(page);
    if (await dialog.count()) {
      const host = (await dialog.locator("h2").innerText()).replace(/^Contact /, "").replace(/\?$/, "");
      await interop.contactButton(dialog, `Always allow ${host}`).click();
    }
    await page.waitForTimeout(100);
  }
  await target.first().waitFor({ timeout: 1 });
}

async function interopChecks({ browser, procs, base }) {
  const hostPort = base + 80;
  const aPort = base + 81;
  const bPort = base + 82;
  const routerPort = base + 83;
  const deniedPort = base + 84; // allowed by no one, never started
  const docsPort = base + 85; // one connected site: the outcome box runs a turn only with one
  const host = `http://localhost:${hostPort}`;
  const A = `http://localhost:${aPort}`;
  const fixtureEnv = { FIXTURE_A: A, FIXTURE_B: `http://localhost:${bPort}`, FIXTURE_DENIED: `http://localhost:${deniedPort}` };
  const slots = ["broken", "cycle_a", "stray", "echo", ...FAN_OUT].map((slug) => `${slug}=${A}`).join(",");
  const run = (file, port, env) => {
    const p = spawn("bun", [file], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", ...env }, stdio: ["ignore", "ignore", "inherit"] });
    procs.push(p);
  };
  run("src/host/server.ts", hostPort, { SITE_ORIGINS: slots });
  run("providers/fixtures/serve.ts", aPort, { ...fixtureEnv, FIXTURE_ROLE: "a" });
  run("providers/fixtures/serve.ts", bPort, { ...fixtureEnv, FIXTURE_ROLE: "b" });
  run("providers/docs.ts", docsPort, { MOSAIC_HOSTS: host });
  const router = await scriptedRouter(routerPort);
  try {
    await Promise.all([host, A, `http://localhost:${bPort}`, `http://localhost:${docsPort}`].map((u) => waitFor(`${u}/`)));
    const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(host);
    const panel = await settings.open(page);
    await settings.saveProfile(panel, { router: `http://localhost:${routerPort}/v1`, model: "interop-model", key: KEY, name: "Interop" });
    await settings.waitInUse(panel, "Interop");
    await page.keyboard.press("Escape");
    await entry.connect(page, docsPort);
    await agent.modeLine(page, "model").waitFor();

    const runOutcome = async (text) => {
      await agent.setOutcome(page, text);
      await agent.submitOutcome(page);
      await agent.turn(page).waitFor();
    };

    // 31. §6.4 Declined: a visible message, and the page sent nothing to the fixture origin.
    const before = requests.length;
    await runOutcome("Ask echo, then decline");
    const contact = interop.contactDialog(page, `localhost:${aPort}`);
    await contact.waitFor();
    await interop.contactButton(contact, "Decline").click();
    await interop.problem(page, `You declined to contact localhost:${aPort}. Nothing was sent to it.`).waitFor();
    await interop.summary(page).waitFor();
    assert.deepEqual(requests.slice(before).filter((u) => u.startsWith(A)), [], "nothing reached a declined origin");

    // 32. §6.7 An invalid network: the runtime refuses it before it runs.
    await runOutcome("Use the invalid network");
    await untilVisible(page, interop.problem(page, `Network 'broken' (localhost:${aPort}) failed validation: Agent 'broken_assistant' references missing tool 'ghost_agent'.`));

    // 33. §6.7 A composition cycle: cycle_b is never offered cycle_a again.
    await runOutcome("Run the cycle");
    await untilVisible(page, interop.problem(page, "Skipped: already visited in this request (a cycle)"));

    // 34. §6.7 Over budget: the ninth peer network is skipped, not fetched.
    await runOutcome("Fan out over budget");
    await untilVisible(page, interop.problem(page, "Skipped: the per-query limit of 8 third-party calls was reached"), 40_000);
    assert.equal(requests.filter((u) => u === `${A}/fan_9.network.json`).length, 0, "the ninth network was never fetched");

    // 35. §6.7 A denied origin: the peer's own manifest does not allow it, so nothing is sent there.
    await runOutcome("Try the denied origin");
    await untilVisible(page, interop.problem(page, `Policy: localhost:${deniedPort} is not in broken's allowed_peers; refusing to contact it.`));
    assert.equal(requests.filter((u) => u.startsWith(`http://localhost:${deniedPort}`)).length, 0, "nothing reached the denied origin");
    if (process.env.C12_SCREENSHOT) await page.screenshot({ path: process.env.C12_SCREENSHOT, fullPage: true });
    if (process.env.C12_FORCE_FAIL) assert.fail("C12_FORCE_FAIL: a forced failure, to prove the servers stop");
    await context.close();
  } finally {
    router.close();
  }
}

module.exports = { interopChecks };
