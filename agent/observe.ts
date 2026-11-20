// What Scout sees on a site: a short crawl of same-origin pages, each reduced to its forms, tables,
// lists and headings with a CSS selector for each, plus a screenshot of the first page. Both
// learners (heuristic and model) work from this, never from raw HTML.
import type { Browser, Page } from "playwright-core";

export type FieldSnap = { name: string; selector: string; label: string; type: string; required: boolean; value: string };
export type FormSnap = {
  selector: string;
  method: "get" | "post";
  label: string;
  submit: { selector: string; text: string };
  fields: FieldSnap[];
};
export type TableSnap = { selector: string; name: string; headers: string[]; rows: number };
export type ListSnap = { selector: string; name: string; count: number; sample: string };
export type PageSnap = { path: string; title: string; h1: string; forms: FormSnap[]; tables: TableSnap[]; lists: ListSnap[]; links: string[] };
export type Observation = { origin: string; name: string; themeColor?: string; pages: PageSnap[]; screenshot: Buffer };

/** "/thread/12/reply" and "/thread/7/reply" are the same kind of page. */
export const pathPattern = (path: string) => path.replace(/\/\d+(?=\/|$)/g, "/:id");

async function snapshot(page: Page): Promise<Omit<PageSnap, "path">> {
  return page.evaluate(() => {
    const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
    const headingBefore = (n: Element) => {
      let cur: Element | null = n;
      while (cur) {
        let sib = cur.previousElementSibling;
        while (sib) {
          if (/^H[1-4]$/.test(sib.tagName)) return text(sib);
          sib = sib.previousElementSibling;
        }
        cur = cur.parentElement;
      }
      return "";
    };
    const unique = (sel: string, n: Element) => (document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === n ? sel : null);
    const selectorFor = (n: Element): string => {
      const tag = n.tagName.toLowerCase();
      const tries = [
        n.id && `#${CSS.escape(n.id)}`,
        n.getAttribute("name") && `${tag}[name=${q(n.getAttribute("name")!)}]`,
        n.getAttribute("aria-label") && `${tag}[aria-label=${q(n.getAttribute("aria-label")!)}]`,
        n.classList.length && `${tag}.${[...n.classList].map((c) => CSS.escape(c)).join(".")}`,
        tag,
      ].filter(Boolean) as string[];
      for (const t of tries) if (unique(t, n)) return t;
      const parent = n.parentElement;
      const idx = parent ? [...parent.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1 : 1;
      return `${parent && parent !== document.body ? selectorFor(parent) + " > " : ""}${tag}:nth-of-type(${idx})`;
    };
    const labelFor = (f: Element) => {
      const id = f.id;
      const byFor = id ? document.querySelector(`label[for=${q(id)}]`) : null;
      return text(byFor) || text(f.closest("label")) || f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.getAttribute("name") || "";
    };

    const forms = [...document.querySelectorAll("form")].map((form) => {
      const fsel = selectorFor(form);
      const fields = [...form.querySelectorAll("input, textarea, select")]
        .filter((f) => !["hidden", "submit", "button", "reset", "image"].includes((f as HTMLInputElement).type) && f.getAttribute("name"))
        .map((f) => ({
          name: f.getAttribute("name")!,
          selector: f.id && unique(`#${CSS.escape(f.id)}`, f) ? `#${CSS.escape(f.id)}` : `${fsel} ${f.tagName.toLowerCase()}[name=${q(f.getAttribute("name")!)}]`,
          label: labelFor(f),
          type: f.tagName === "TEXTAREA" ? "textarea" : f.tagName === "SELECT" ? "select" : (f as HTMLInputElement).type || "text",
          required: (f as HTMLInputElement).required,
          value: (f as HTMLInputElement).value ?? "",
        }));
      const button = form.querySelector('button:not([type=button]):not([type=reset]), input[type=submit]');
      return {
        selector: fsel,
        method: (form.getAttribute("method") ?? "get").toLowerCase() === "post" ? ("post" as const) : ("get" as const),
        label: form.getAttribute("aria-label") || text(form.querySelector("legend")) || headingBefore(form),
        submit: { selector: button ? `${fsel} ${button.tagName === "INPUT" ? "input[type=submit]" : "button"}` : "", text: text(button) || (button as HTMLInputElement | null)?.value || "" },
        fields,
      };
    });

    const tables = [...document.querySelectorAll("table")].map((t) => ({
      selector: selectorFor(t),
      name: text(t.querySelector("caption")) || t.id || headingBefore(t),
      headers: [...t.querySelectorAll("th")].map(text),
      rows: t.querySelectorAll("tbody tr").length || t.querySelectorAll("tr").length - 1,
    }));

    const lists = [...document.querySelectorAll("main ol, main ul, article ol, article ul")]
      .filter((l) => l.children.length >= 2 && !l.closest("nav, header, footer"))
      .map((l) => ({ selector: `${selectorFor(l)} > li`, name: l.getAttribute("aria-label") || (l.className ? l.className.split(" ")[0]! : headingBefore(l)), count: l.children.length, sample: text(l.children[0]).slice(0, 120) }));

    const links = [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href);
    return { title: document.title, h1: text(document.querySelector("h1")), forms, tables, lists, links };
  });
}

/** The site's name: the part of the page titles that every page shares ("Threads · Corkboard"). */
function siteName(titles: string[], origin: string): string {
  const tails = titles.map((t) => t.split(/\s[·|—–-]\s/).pop()!.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const t of tails) counts.set(t, (counts.get(t) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] > 1 ? best[0] : new URL(origin).hostname;
}

/** Visit up to `maxPages` same-origin pages, one per kind of path, starting at `start`. */
export async function observe(browser: Browser, start: string, maxPages = 8): Promise<Observation> {
  const origin = new URL(start).origin;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const pages: PageSnap[] = [];
  const seen = new Set<string>();
  const queue = [new URL(start).pathname + new URL(start).search];
  let screenshot: Buffer = Buffer.alloc(0);
  let themeColor: string | undefined;
  try {
    while (queue.length && pages.length < maxPages) {
      const path = queue.shift()!;
      const pattern = pathPattern(new URL(path, origin).pathname);
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      const res = await page.goto(new URL(path, origin).href, { waitUntil: "load" }).catch(() => null);
      if (!res || !res.ok() || new URL(page.url()).origin !== origin) continue;
      if (!pages.length) {
        screenshot = await page.screenshot({ type: "png" });
        themeColor = (await page.locator('meta[name="theme-color"]').getAttribute("content").catch(() => null)) ?? undefined;
      }
      const snap = await snapshot(page);
      const here = new URL(page.url());
      pages.push({ ...snap, path: here.pathname + here.search, links: [] });
      for (const href of snap.links) {
        const u = new URL(href);
        if (u.origin === origin && !seen.has(pathPattern(u.pathname))) queue.push(u.pathname + u.search);
      }
    }
  } finally {
    await context.close();
  }
  if (!pages.length) throw new Error(`could not open any page on ${origin}`);
  return { origin, name: siteName(pages.map((p) => p.title), origin), themeColor: themeColor?.match(/^#[0-9a-f]{6}$/i) ? themeColor : undefined, pages, screenshot };
}
