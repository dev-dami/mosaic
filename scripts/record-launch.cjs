// Records the 30-second launch video: outcome, three sites connected, data flowing between them,
// a write approved on the site's own sheet, then a site Mosaic has never seen connected live.
//
// Live take: set MOSAIC_URL, SITE_DOCS, SITE_RELEASES, SITE_ANNOUNCER and SITE_INKPOST to the
// deployed origins (the host must suggest the first three). Without them the script starts every
// server locally, as a dry run for timing; the video then says "local dry run" in its corner.
//
// Output: launch/mosaic-launch.webm (VP9, 1600x900). Set CHROMIUM_PATH as for the e2e test.
const { chromium } = require("playwright-core");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const entry = require("../e2e/areas/entry.cjs");
const runbook = require("../e2e/areas/runbook.cjs");
const review = require("../e2e/areas/review.cjs");
const { buildBadge, buildSame } = require("../e2e/areas/shell.cjs");

const W = 1600;
const H = 900;
const OUT = path.resolve("launch");
const FFMPEG = process.env.FFMPEG ?? `${process.env.HOME}/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux`;
const procs = [];
const live = !!process.env.MOSAIC_URL;

function local() {
  const base = Number(process.env.RECORD_PORT_BASE ?? 5600);
  const url = (p) => `http://localhost:${p}`;
  const sites = { docs: url(base + 101), releases: url(base + 102), announcer: url(base + 103), inkpost: url(base + 104) };
  const run = (role, port, env) =>
    procs.push(spawn("bun", ["server.ts"], { env: { ...process.env, ...env, MOSAIC_ROLE: role, PORT: String(port), NODE_ENV: "production" }, stdio: "ignore" }));
  run("host", base, { MOSAIC_SUGGEST: [sites.docs, sites.releases, sites.announcer].join(",") });
  for (const [role, port] of [["docs", 101], ["releases", 102], ["announcer", 103], ["newsletter", 104]]) run(role, base + port, { MOSAIC_HOSTS: url(base) });
  return { host: url(base), ...sites };
}

const urls = live
  ? { host: process.env.MOSAIC_URL, docs: process.env.SITE_DOCS, releases: process.env.SITE_RELEASES, announcer: process.env.SITE_ANNOUNCER, inkpost: process.env.SITE_INKPOST }
  : local();

async function waitFor(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not answer`);
}

// Overlays live outside React's root, so re-renders never touch them. Headless video has no
// pointer, so a drawn cursor follows every glide.
const OVERLAY = `
(() => {
  const css = document.createElement("style");
  css.textContent = \`
    #lv-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -4px 0 0 -4px; pointer-events: none;
      transition: transform .12s ease, left .36s cubic-bezier(.3,.7,.2,1), top .36s cubic-bezier(.3,.7,.2,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    #lv-cursor.down { transform: scale(.82); }
    #lv-cap { position: fixed; z-index: 2147483646; left: 50%; bottom: 34px; transform: translate(-50%, 12px); opacity: 0;
      transition: opacity .35s ease, transform .35s ease; pointer-events: none; display: flex; gap: 14px; align-items: center;
      background: #151517; color: #f5f4ef; border-radius: 14px; padding: 14px 22px 14px 14px; max-width: 1100px;
      font: 600 24px/1.25 Nunito, "Geist", system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    #lv-cap.on { opacity: 1; transform: translate(-50%, 0); }
    #lv-cap b { display: grid; place-items: center; min-width: 38px; height: 38px; border-radius: 10px; background: #f7a501; color: #151517;
      font: 800 20px/1 Nunito, system-ui, sans-serif; }
    #lv-cap small { display: block; font-weight: 500; font-size: 16px; color: #b9b8b1; margin-top: 3px; }
    #lv-live { position: fixed; z-index: 2147483646; left: 18px; bottom: 18px; pointer-events: none; display: flex; align-items: center; gap: 8px;
      font: 600 13px/1 "Geist Mono", ui-monospace, monospace; color: #3b3b3f; background: rgba(255,255,255,.92); border: 1px solid #dcdad3;
      border-radius: 999px; padding: 7px 12px 7px 10px; }
    #lv-live i { width: 8px; height: 8px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 3px rgba(229,72,77,.18); }
    #lv-live.local i { background: #8b8b90; box-shadow: none; }
    #lv-card { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-content: center; text-align: center; gap: 18px;
      background: #eeefe9; color: #151517; transition: opacity .5s ease; font-family: Nunito, system-ui, sans-serif; }
    #lv-card.off { opacity: 0; pointer-events: none; }
    #lv-card h1 { margin: 0; font: 800 112px/1 Nunito, system-ui, sans-serif; letter-spacing: -0.03em; }
    #lv-card h1 span { color: #151517; }
    #lv-card p { margin: 0 auto; max-width: 900px; font: 400 38px/1.25 Newsreader, Georgia, serif; color: #3b3b3f; }
    #lv-card code { font: 600 18px/1 "Geist Mono", ui-monospace, monospace; color: #6b6b70; }
    #lv-card .tiles { display: flex; justify-content: center; margin-bottom: 8px; }
    #lv-card .logo .piece { transform-box: fill-box; transform-origin: center; animation: lv-drop .55s .7s cubic-bezier(.3,1.5,.5,1) both; }
    @keyframes lv-drop { from { transform: translate(14px, -18px) rotate(25deg) scale(.6); opacity: 0; } }
  \`;
  document.documentElement.append(css);
  const cursor = document.createElement("div");
  cursor.id = "lv-cursor";
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11-6.5 1.2L9 21z" fill="#151517" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  cursor.style.left = "-40px";
  const cap = document.createElement("div");
  cap.id = "lv-cap";
  const chip = document.createElement("div");
  chip.id = "lv-live";
  const card = document.createElement("div");
  card.id = "lv-card";
  card.className = "off";
  document.documentElement.append(card, cap, chip, cursor);
  window.__lv = {
    at(x, y) { cursor.style.left = x + "px"; cursor.style.top = y + "px"; },
    press(down) { cursor.classList.toggle("down", down); },
    caption(n, text, sub) {
      cap.classList.remove("on");
      if (!text) return;
      setTimeout(() => { cap.innerHTML = "<b>" + n + "</b><span>" + text + (sub ? "<small>" + sub + "</small>" : "") + "</span>"; cap.classList.add("on"); }, 180);
    },
    chip(text, isLive) { chip.className = isLive ? "" : "local"; chip.innerHTML = "<i></i>" + text; },
    card(html) { cursor.style.opacity = html === null ? "1" : "0"; if (html === null) { card.classList.add("off"); return; } card.innerHTML = html; card.classList.remove("off"); },
  };
})();
`;

// The mark: four site tiles around the missing piece, which drops in on the card.
const tiles = `<svg class="logo" viewBox="-1 -1 32 32" width="128" height="128"><rect width="19" height="8" rx="2.5" fill="#de4a87"/><rect x="22" width="8" height="19" rx="2.5" fill="#e7a226"/><rect x="11" y="22" width="19" height="8" rx="2.5" fill="#199d78"/><rect y="11" width="8" height="19" rx="2.5" fill="#8568dc"/><rect class="piece" x="11" y="11" width="8" height="8" rx="2.5" fill="#151517"/></svg>`;
const host = (u) => new URL(u).host;

async function main() {
  await Promise.all(Object.values(urls).map((u) => waitFor(u)));
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await context.newPage();
  globalThis.__page = page;
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const t0 = Date.now();
  const mark = (what) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${what}`);
  const lv = (fn, ...args) => page.evaluate(([fn, args]) => window.__lv[fn](...args), [fn, args]);
  const pause = (ms) => page.waitForTimeout(ms);

  /** Glide the drawn cursor (a CSS transition) and the real mouse to the centre of `loc`, then click. */
  async function glide(loc, { click = true } = {}) {
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await lv("at", x, y);
    await page.mouse.move(x, y);
    await pause(380);
    if (!click) return;
    await lv("press", true);
    await loc.click();
    await lv("press", false);
  }

  await page.goto(urls.host);
  await page.evaluate(OVERLAY);
  await buildBadge(page).waitFor();
  const buildBefore = await buildBadge(page).textContent();
  await lv("chip", live ? `live · ${host(urls.host)}` : "local dry run", live);
  await lv("at", W / 2, H / 2);
  const startAt = (Date.now() - t0) / 1000;

  // 0. Title card.
  await lv("card", `<div class="tiles">${tiles}</div><h1>Mosaic<span>.</span></h1><p>Websites publish capabilities.<br>Your browser assembles the app.</p>`);
  mark("title");
  await pause(2600);
  await lv("card", null);
  await pause(400);

  // 1. The outcome.
  await lv("caption", 1, "Say what you want done");
  const outcome = page.locator("#outcome");
  await glide(outcome);
  await outcome.fill("");
  await outcome.pressSequentially("Launch Mosaic v1.0", { delay: 45 });
  mark("outcome typed");
  await pause(500);

  // 2. Three live sites, three origins.
  await lv("caption", 2, "Connect three sites", `${host(urls.docs)} · ${host(urls.releases)} · ${host(urls.announcer)}`);
  // The first comes from the empty page's suggestions; after that they wait in the ⌘K palette.
  for (const [i, site] of [urls.releases, urls.docs, urls.announcer].entries()) {
    if (i === 0) await glide(page.getByRole("button", { name: `Connect ${site}`, exact: true }));
    else {
      await page.keyboard.press("Control+K");
      await glide(page.locator(".palette .connect-row", { hasText: host(site) }));
    }
    await page.locator(`.source.ready[data-origin="${site}"]`).waitFor();
    await pause(350);
    await page.keyboard.press("Escape");
    await page.locator(".palette").waitFor({ state: "detached" });
  }
  mark("three connected");
  await pause(500);

  // 3. One site's output feeds the next.
  await lv("caption", 3, "Each site's output feeds the next", "Tagforge's changelog fills Loudhailer's post");
  const draft = runbook.readBlock(page, urls.releases, "draft-changelog");
  await draft.scrollIntoViewIfNeeded();
  await runbook.fillInput(draft, "Highlights (one per line)", "First public release\nConnect any site at runtime");
  await glide(draft.getByRole("button", { name: "Run Draft changelog" }));
  await runbook.waitOutputItem(draft, "Connect any site at runtime");
  const announce = runbook.readBlock(page, urls.announcer, "draft-announcement");
  await glide(announce.getByRole("button", { name: "Run Draft announcement" }));
  await runbook.waitOutput(announce, "Introducing Mosaic v1.0");
  await glide(draft.locator('.out-token[data-flow-src$="|notes"]'), { click: false });
  mark("data flow");
  await pause(1500);

  // 4. A write, approved on the site's own sheet.
  await lv("caption", 4, "Writes are approved on the site's own sheet", "Drawn by Tagforge, on its origin. Mosaic cannot press it.");
  const publish = review.writeCard(page, urls.releases, "publish-release");
  await review.start(publish, "Publish release");
  const sheet = review.sheet(page, urls.releases);
  await review.waitSheetValue(sheet, "Connect any site at runtime");
  await pause(900);
  await glide(review.approveButton(sheet));
  await review.waitReceipt(publish, "/releases/v1.0");
  mark("approved");
  await pause(1200);

  // 5. A site Mosaic has never seen.
  await lv("caption", 5, "A site Mosaic has never seen", "New controls in seconds. No Mosaic redeploy.");
  // The approve click left focus in the site's frame, so open the palette from the top bar.
  await glide(page.getByRole("button", { name: "Search or connect a site" }));
  const input = page.getByLabel("Site URL or search");
  await input.pressSequentially(urls.inkpost, { delay: 18 });
  await input.press("Enter");
  await page.locator(`.source.ready[data-origin="${urls.inkpost}"]`).waitFor();
  await pause(1800);
  await page.keyboard.press("Escape");
  await buildSame(page).waitFor();
  if ((await buildBadge(page).textContent()) !== buildBefore) throw new Error("Mosaic's build changed");
  await glide(buildBadge(page), { click: false });
  mark("inkpost connected, build unchanged");
  await pause(1300);

  // 6. End card.
  await lv("caption", 0, "");
  await lv("card", `<div class="tiles">${tiles}</div><h1>Mosaic<span>.</span></h1><p>The browser assembles a working app<br>from the capabilities websites publish.</p><code>${live ? host(urls.host) : "Open Agentic Web Challenge"}</code>`);
  await pause(2800);
  const endAt = (Date.now() - t0) / 1000;
  mark("end");

  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video.path();
  const out = path.join(OUT, "mosaic-launch.webm");
  // Cut the page load before the title card, then fit the take to 30 s. The bundled ffmpeg has no
  // speed filters, so -itsscale rescales the input timestamps and -ss/-t cut on the output side.
  const scale = Math.min(1, 30 / (endAt - startAt));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-itsscale", scale.toFixed(4), "-i", raw, "-ss", (startAt * scale).toFixed(2), "-t", ((endAt - startAt) * scale).toFixed(2), "-r", "30", "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", out]);
  fs.rmSync(raw);
  console.log(`${out}  ${((endAt - startAt) * scale).toFixed(1)} s (take ${(endAt - startAt).toFixed(1)} s, x${(1 / scale).toFixed(2)})`);
}

main()
  .catch(async (e) => {
    await globalThis.__page?.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => procs.forEach((p) => p.kill()));
