// Which sites Scout may open, and the fence that keeps its browser on one of them.
// SCOUT_TARGETS lists the allowed target origins (exact origin match, comma separated). With no
// list, Scout allows loopback only (localhost, 127.0.0.1, [::1], any port), so `bun run dev` works
// and nothing else does. A public Scout must set SCOUT_TARGETS.
import type { Browser, BrowserContext, Page } from "playwright-core";

/** A request Scout will not serve. `status` is the HTTP status the caller gets. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Returns why Scout may not open `url`, or null when it may. */
export type TargetPolicy = (url: string) => string | null;

export function targetPolicy(list: string | undefined = process.env.SCOUT_TARGETS): TargetPolicy {
  const allowed = (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  return (url) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return `${url} is not a URL`;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return `Scout opens http and https sites only, not ${u.protocol}`;
    if (allowed.length) return allowed.includes(u.origin) ? null : `${u.origin} is not in SCOUT_TARGETS, the list of sites this Scout may open`;
    return LOOPBACK.has(u.hostname) ? null : `${u.origin} is not a loopback address; set SCOUT_TARGETS to let this Scout open other sites`;
  };
}

/** Throws a 403 Refused when the policy does not allow `url`. */
export function checkTarget(policy: TargetPolicy, url: string): URL {
  const why = policy(url);
  if (why) throw new Refused(why, 403);
  return new URL(url);
}

/**
 * A new browser context whose page can reach `origin` only. Every request the page makes is paused
 * at the network layer (CDP Fetch), redirect hops included, and any request to another origin fails
 * before it is sent. Playwright's own route() is not enough: it does not see redirect hops.
 * Service workers are blocked and popups are closed, since the fence covers this one page.
 */
export async function fencedPage(browser: Browser, origin: string, viewport?: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "block", ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", (e) => {
    const url = e.request.url;
    const ok = url.startsWith("data:") || url.startsWith("blob:") || URL.parse(url)?.origin === origin;
    const reply = ok ? cdp.send("Fetch.continueRequest", { requestId: e.requestId }) : cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" });
    reply.catch(() => {}); // the page may close while a request is paused
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  context.on("page", (p) => {
    if (p !== page) void p.close();
  });
  return { context, page };
}
