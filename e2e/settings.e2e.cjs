// The AI model settings (card C6): save, select and delete a BYOK profile; the key never reaches
// the URL, a cookie, the page's text or any request except Authorization at the chosen router; and
// one turn runs against a local OpenAI-compatible mock router. Called from mosaic.e2e.cjs.
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");
const settings = require("./areas/settings.cjs");

const KEY = "otk_test123";
const KEY2 = "otk_second456";
const KEY3 = "sk-ant-e2e-claude";
const CLAUDE_ANSWER = "CLAUDE_STUB: read over the Messages API.";

/** One Messages API reply as server-sent events, for a stubbed api.anthropic.com. */
function claudeSse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return (
    ev("message_start", { message: { id: "msg_e2e", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }) +
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
    ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) +
    ev("message_stop", {})
  );
}
const ANSWER = "MOCK_ANSWER: the router read your request.";

/** A scripted OpenAI-compatible router. Records each request's path, whether it had Authorization, and the tools offered. */
function mockRouter(port) {
  const seen = [];
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization || "";
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const parsed = JSON.parse(body || "{}");
        seen.push({ path: req.url, auth, tools: (parsed.tools || []).map((t) => t.function.name) });
        res.setHeader("content-type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ model: parsed.model, choices: [{ delta: { content: ANSWER }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: parsed.model, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      seen.push({ path: req.url, auth });
      res.statusCode = 404;
      res.end("not found");
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

/** No trace of the key anywhere the page shows or stores outside byok's localStorage. */
async function assertKeyHidden(page, key, when) {
  const leak = await page.evaluate((k) => ({
    href: location.href.includes(k),
    cookie: document.cookie.includes(k),
    text: document.body.innerText.includes(k),
    html: document.documentElement.outerHTML.includes(k),
  }), key);
  assert.deepEqual(leak, { href: false, cookie: false, text: false, html: false }, `key visible ${when}`);
}

async function settingsChecks({ browser, procs, base, sitePort, screenshot }) {
  const hostPort = base + 20;
  const routerPort = base + 30;
  const host = `http://localhost:${hostPort}`;
  const routerUrl = `http://localhost:${routerPort}/v1`;
  const p = spawn("bun", ["src/host/server.ts"], {
    env: { ...process.env, PORT: String(hostPort), SITE_ORIGINS: `pagewright=http://localhost:${sitePort}`, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  procs.push(p);
  const { server, seen } = await mockRouter(routerPort);
  try {
    await waitFor(`${host}/`);
    const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const requests = [];
    // A request can still be in flight when the context closes; its headers are then unreadable.
    page.on("request", (req) => requests.push(req.allHeaders().then((headers) => ({ url: req.url(), headers }), () => null)));
    await page.goto(host);

    // 12. With no key, Mosaic says it plans without a model.
    let panel = await settings.open(page);
    await settings.mode(panel, "manual").waitFor();
    assert.match(await settings.mode(panel, "manual").innerText(), /No key: Mosaic plans steps without a model/);

    // 13. Save a profile: it is in use, the note names only the router host, and the key is nowhere visible.
    await settings.saveProfile(panel, { router: routerUrl, model: "mock-model-1", key: KEY, name: "Mock" });
    await settings.waitInUse(panel, "Mock");
    await settings.mode(panel, "model").waitFor();
    assert.equal(await settings.keyNote(panel).innerText(), `Your key is sent only to localhost:${routerPort}. Mosaic and the sites you connect never see it.`);
    await assertKeyHidden(page, KEY, "after save");
    if (screenshot) await panel.screenshot({ path: screenshot });

    // 14. A turn runs on the mock router, with the key as Authorization there and nowhere else.
    const answer = await settings.testModel(panel);
    assert.equal(await answer.getAttribute("class"), "check-line ok", await answer.innerText());
    assert.equal(await answer.innerText(), ANSWER);
    const chats = seen.filter((r) => r.path === "/v1/chat/completions");
    assert.ok(chats.length >= 1, "the router got the chat call");
    assert.ok(chats.every((r) => r.auth === `Bearer ${KEY}`), "Authorization carries the selected key");
    assert.ok(seen.filter((r) => r.path !== "/v1/chat/completions").every((r) => !r.auth), "only the chat call carries a key");
    assert.deepEqual(chats[0].tools, ["pagewright", "composer"], "unbound spare slots are hidden from the model");

    // 15. A second profile, select the first again, then delete both: back to manual mode.
    await settings.saveProfile(panel, { router: routerUrl, model: "mock-model-2", key: KEY2, name: "Second" });
    await settings.waitInUse(panel, "Second");
    await settings.use(panel, "Mock");
    await settings.waitInUse(panel, "Mock");
    await assertKeyHidden(page, KEY, "after select");
    await assertKeyHidden(page, KEY2, "after select");
    await settings.remove(panel, "Second");
    await settings.remove(panel, "Mock");
    await settings.mode(panel, "manual").waitFor();
    await assertKeyHidden(page, KEY, "after delete");

    // 15b. The Claude preset: a turn goes to api.anthropic.com/v1/messages (stubbed here) in the
    //      Messages API format, with the key as authorization there, not to an OpenAI-format path.
    const claudeCalls = [];
    await context.route("https://api.anthropic.com/**", async (route) => {
      const req = route.request();
      claudeCalls.push({ url: req.url(), auth: (await req.allHeaders()).authorization, body: req.postDataJSON() });
      await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: claudeSse(CLAUDE_ANSWER) });
    });
    await settings.preset(panel, "claude");
    assert.equal(await panel.getByLabel("Router base URL").inputValue(), "https://api.anthropic.com");
    assert.equal(await panel.getByLabel("Model").inputValue(), "claude-opus-5-5");
    await panel.getByLabel("Key", { exact: true }).fill(KEY3);
    await panel.getByRole("button", { name: "Save and use" }).click();
    await settings.waitInUse(panel, "Claude");
    await panel.getByRole("button", { name: "Test model" }).click();
    await panel.locator(".check-line.ok", { hasText: CLAUDE_ANSWER }).waitFor({ timeout: 20000 });
    // The runtime probes a custom router's /agent-manifest.json for a published mock (engine.js
    // loadTop). That probe carries no key; every other call is a Messages API call.
    const probes = claudeCalls.filter((c) => new URL(c.url).pathname === "/agent-manifest.json");
    assert.ok(probes.every((c) => !c.auth), "the manifest probe carries no key");
    const messageCalls = claudeCalls.filter((c) => !probes.includes(c));
    assert.ok(messageCalls.length >= 1, "api.anthropic.com got the call");
    for (const c of messageCalls) {
      assert.equal(new URL(c.url).pathname, "/v1/messages");
      assert.equal(c.auth, `Bearer ${KEY3}`);
      assert.equal(c.body.model, "claude-opus-5-5");
      assert.equal(c.body.stream, true);
    }
    assert.deepEqual(messageCalls[0].body.tools.map((t) => t.name), ["pagewright", "composer"]);
    await assertKeyHidden(page, KEY3, "after the Claude turn");
    await settings.remove(panel, "Claude");
    await settings.mode(panel, "manual").waitFor();

    // 16. No request from the page, to any origin, carried a key except Authorization at its router.
    const all = (await Promise.all(requests)).filter(Boolean);
    for (const { url, headers } of all) {
      for (const [name, value] of Object.entries(headers)) {
        if (value.includes(KEY3)) {
          assert.ok(name === "authorization" && url.startsWith("https://api.anthropic.com/v1/messages"), `the Claude key leaked in ${name} to ${url}`);
          continue;
        }
        if (!value.includes(KEY) && !value.includes(KEY2)) continue;
        assert.ok(name === "authorization" && url.startsWith(routerUrl), `the key leaked in ${name} to ${url}`);
      }
    }
    await context.close();
  } finally {
    server.close();
  }
}

module.exports = { settingsChecks };
