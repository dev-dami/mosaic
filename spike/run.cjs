// SPIKE (throwaway, C1): drive the vendored Engine in headless Chromium against spike/serve.ts.
// Run: CHROMIUM_PATH=... node spike/run.cjs   (with `bun spike/serve.ts` up)
const { chromium } = require("playwright-core");

const out = {};
const log = (k, v) => { out[k] = v; console.log(`\n## ${k}\n${JSON.stringify(v, null, 2)}`); };

async function turn(page, engineExpr, text) {
  return page.evaluate(async ({ engineExpr, text }) => {
    const engine = eval(engineExpr);
    const events = [];
    let final = null;
    let error = null;
    try {
      for await (const ev of engine.streamTurn(text)) {
        events.push(ev.type);
        if (ev.type === "final" || ev.type === "result" || ev.type === "done") final = ev;
      }
    } catch (e) { error = String(e.message || e); }
    const items = [...engine.trace.spans.values(), ...engine.trace.events.filter((ev) => ev.phase === "note")];
    const spans = items.filter((s) => ["remote_fetch", "remote_call", "composition_limit", "link", "consent"].includes(s.kind))
      .map((s) => ({ kind: s.kind, status: s.status, peer: s.peerOrigin, network: s.network, reason: s.reason, error: s.error }));
    engine.trace.spans.clear(); engine.trace.events.length = 0;
    const last = engine.history.at(-1);
    return { events: [...new Set(events)], answer: last?.content?.slice(0, 1500), error, spans };
  }, { engineExpr, text });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[page ${m.type()}] ${m.text()}`); });
  await page.goto("http://localhost:4000/spike.html");
  await page.waitForFunction(() => window.__ready === true);

  // R0: Engine without mountApp, loadTop, bind a slot, one streamTurn, exact-name resolveRemote.
  log("R0.loadTop", await page.evaluate(async () => {
    const { Engine, TraceBus } = window.__rt;
    const e = window.e1 = new Engine({ originUrl: "http://localhost:4000/h1", trace: new TraceBus() });
    const { network, validation } = await e.loadTop();
    e.onLinkRequired = async () => null; // unbound slots: decline instead of throwing
    e.top.network.setLink("pagewright_slot", "http://localhost:4101/pagewright");
    e.runtimeAllowedPeers.add("http://localhost:4101");
    return { network: network.name, frontMan: network.findFrontMan(), errors: validation.errors, linkSlots: [...network.linkSlots], mountedUi: !!document.querySelector("[data-nsdeploy-ui]") };
  }));
  log("R0.streamTurn", await turn(page, "window.e1", "Preview docs for v1.0"));
  log("R2.toolsOfferedToHostFront", (await (await fetch("http://localhost:4199/records")).json()).filter((r) => r.tools.some((t) => !t.startsWith("website_"))).slice(0, 1));
  log("R0.resolveRemote", await page.evaluate(async () => {
    const e = window.e1;
    const r = {};
    const ok = await e.resolveRemote("http://localhost:4101/pagewright", [], null);
    r.exact = { network: ok.network.name, base: ok.base };
    try { await e.resolveRemote("http://localhost:4101/wrongname", [], null); r.wrong = "resolved?!"; } catch (err) { r.wrong = String(err.message); }
    try { await e.resolveRemote("http://localhost:4101/Pagewright", [], null); r.caseVariant = "resolved?!"; } catch (err) { r.caseVariant = String(err.message); }
    try { r.linkNormalizeWrongName = await e._normalizeLinkTarget("pagewright_slot", "http://localhost:4101/wrongname"); } catch (err) { r.linkNormalizeWrongName = "threw: " + err.message; }
    try { await e.resolveRemote("http://localhost:4111/pw2", [], null); r.notAllowed = "resolved?!"; } catch (err) { r.notAllowed = String(err.message); }
    r.actionsRegistered = [...e.actions.entries.values()].map((a) => ({ name: a.name, effect: a.effect, availability: a.availability, confirmsInWindow: a.confirmsInWindow, base: a.base }));
    return r;
  }));

  // R2 workaround probe: drop unbound slot refs from the front agent's tools after loadTop.
  log("R2.pruneUnboundSlots", await page.evaluate(async () => {
    const { Engine, TraceBus } = window.__rt;
    const e = window.e2 = new Engine({ originUrl: "http://localhost:4000/h1", trace: new TraceBus() });
    await e.loadTop();
    e.top.network.setLink("pagewright_slot", "http://localhost:4101/pagewright");
    e.runtimeAllowedPeers.add("http://localhost:4101");
    const spec = e.top.network.getAgentSpec(e.top.network.findFrontMan());
    spec.tools = spec.tools.filter((ref) => !e.top.network.linkSlots.has(ref) || e.top.network.getLink(ref));
    return { frontTools: spec.tools };
  }));
  const before = (await (await fetch("http://localhost:4199/records")).json()).length;
  log("R2.turnAfterPrune", await turn(page, "window.e2", "Preview docs for v1.0"));
  log("R2.toolsOfferedAfterPrune", (await (await fetch("http://localhost:4199/records")).json()).slice(before, before + 1));

  // R1: five peers in one turn, default limit, then a subclass that raises it.
  await page.evaluate(() => {
    const { Engine, TraceBus } = window.__rt;
    window.e5 = new Engine({ originUrl: "http://localhost:4000/h5", trace: new TraceBus() });
    class Raised extends Engine {
      _makeCtx(args) { if (args.composition) args.composition.maxRemoteCalls = 8; return super._makeCtx(args); }
    }
    window.e5r = new Raised({ originUrl: "http://localhost:4000/h5", trace: new TraceBus() });
  });
  log("R1.default", await turn(page, "window.e5", "Five peers please"));
  log("R1.subclassRaised", await turn(page, "window.e5r", "Five peers please"));

  // R3: a partner write during a turn. Watch for the dialog and for popups, then click.
  const popups = [];
  context.on("page", (p) => popups.push(p));
  await page.evaluate(() => {
    const { Engine, TraceBus } = window.__rt;
    const e = window.e3 = new Engine({ originUrl: "http://localhost:4000/h1", trace: new TraceBus() });
    e.onLinkRequired = async () => null;
    window.__t3 = (async () => {
      await e.loadTop();
      e.top.network.setLink("pagewright_slot", "http://localhost:4101/pagewright");
      e.runtimeAllowedPeers.add("http://localhost:4101");
      const events = [];
      try { for await (const ev of e.streamTurn("APPLY docs for v1.0")) events.push(ev.type); } catch (err) { return { error: String(err.message) }; }
      return { answer: e.history.at(-1)?.content?.slice(0, 1500) };
    })();
  });
  await page.waitForSelector("dialog[open]", { timeout: 20000 });
  const dialogText = await page.$eval("dialog[open]", (d) => d.innerText);
  await page.waitForTimeout(1500);
  const popupsBeforeClick = popups.length;
  await page.click("dialog[open] button:has-text('Open action site')");
  for (let i = 0; i < 50 && !popups.length; i++) await page.waitForTimeout(100);
  const popup = popups[0];
  let popupUrl = popup && popup.url();
  if (popup) {
    await popup.waitForSelector("#approve", { timeout: 15000 });
    popupUrl = popup.url();
    await popup.click("#approve");
  }
  const r3 = await page.evaluate(() => window.__t3);
  log("R3", { dialogText, popupsBeforeClick, popupsAfterClick: popups.length, popupUrl, turn: r3 });
  await browser.close();

  // R3b: does Chromium (popup blocker on) let window.open run with no gesture?
  const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, ignoreDefaultArgs: ["--disable-popup-blocking"] });
  const p2 = await (await b2.newContext()).newPage();
  await p2.goto("http://localhost:4000/spike.html");
  const noGesture = await p2.evaluate(() => new Promise((r) => setTimeout(() => r(!!window.open("about:blank", "_blank", "popup")), 50)));
  await p2.evaluate(() => { document.body.innerHTML = '<button id="b">open</button>'; window.__opened = null; document.getElementById("b").onclick = () => { window.__opened = !!window.open("about:blank", "_blank", "popup"); }; });
  await p2.click("#b");
  log("R3b.popupBlocker", { windowOpenWithoutGesture: noGesture, windowOpenInClick: await p2.evaluate(() => window.__opened) });
  await b2.close();
})().catch((e) => { console.error(e); process.exit(1); });
