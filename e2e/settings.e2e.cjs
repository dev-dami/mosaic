// The AI model settings (card C6): save, select and delete a BYOK profile; the key never reaches
// the URL, a cookie, the page's text or any request except Authorization at the chosen router; and
// one turn runs against a local OpenAI-compatible mock router. Called from mosaic.e2e.cjs.
const { spawn } = require("node:child_process");
const http = require("node:http");
const assert = require("node:assert/strict");
const settings = require("./areas/settings.cjs");

const KEY = "otk_test123";
const KEY2 = "otk_second456";
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

    // 16. No request from the page, to any origin, carried the key except Authorization at the router.
    const all = (await Promise.all(requests)).filter(Boolean);
    for (const { url, headers } of all) {
      for (const [name, value] of Object.entries(headers)) {
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
