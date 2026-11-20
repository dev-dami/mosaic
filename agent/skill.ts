// A learned skill: one thing a site's pages can do, written as a short browser script. Scout writes
// skills by looking at a site (agent/learn-*.ts), saves them in an adapter file, and runs them here.
// An adapter is a template for a site that publishes no manifest. It holds plain capabilities plus
// the steps that perform each one, so any Scout can load it, and a site owner can publish the
// capabilities part as their own manifest.
import type { Browser, Page } from "playwright-core";
import type { Capability, JsonSchema } from "../src/protocol";

export type StepOp = "goto" | "fill" | "check" | "click" | "extract";
export type ExtractKind = "text" | "list" | "table" | "url";

/**
 * One browser step. Fields that an op does not use are empty strings, so the same flat shape works
 * for a model's structured output and for hand-written adapters.
 * - goto: open `url`, a path on the target site; {{field}} is replaced (URL-encoded).
 * - fill: type `value` into `selector`; {{field}} is replaced.
 * - check: tick `selector` when `value` renders truthy, untick it otherwise.
 * - click: press `selector` and wait for the page that follows.
 * - extract: read `selector` into output `field` as text, a list of texts, a table, or the page URL.
 */
export type Step = { op: StepOp; selector: string; value: string; url: string; field: string; kind: ExtractKind | "" };

export type SkillField = {
  name: string;
  label: string;
  type: "string" | "text" | "boolean";
  required: boolean;
  /** A value seen while learning (for example a thread id in a URL). Used to try reads. */
  example: string;
};

export type Skill = {
  id: string;
  title: string;
  description: string;
  side_effects: "read" | "write";
  fields: SkillField[];
  steps: Step[];
  /** True when Scout ran it while learning and every step worked. Writes are never run while learning. */
  verified?: boolean;
};

export type Adapter = {
  mosaic: "adapter/0";
  /** The site the skills drive. It did not publish them. */
  target: { origin: string; name: string; theme_color?: string };
  learned: { by: string; at: string };
  skills: Skill[];
};

export const step = (s: Partial<Step> & { op: StepOp }): Step => ({ selector: "", value: "", url: "", field: "", kind: "", ...s });

export const slug = (s: string, max = 40) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "skill";

const fieldKey = (s: string) => slug(s).replace(/-/g, "_");

/** The capability a skill offers, in the manifest's own terms. */
export function toCapability(skill: Skill): Capability {
  const properties: Record<string, JsonSchema> = {};
  for (const f of skill.fields) {
    properties[f.name] =
      f.type === "boolean"
        ? { type: "boolean", title: f.label }
        : { type: "string", title: f.label, ...(f.type === "text" ? { "x-mosaic-widget": "textarea" as const } : {}) };
  }
  const outputs: Record<string, JsonSchema> = {};
  for (const s of skill.steps) {
    if (s.op !== "extract" || !s.field) continue;
    outputs[s.field] =
      s.kind === "list" ? { type: "array", items: { type: "string" } } : s.kind === "table" ? { type: "array", items: { type: "object" } } : { type: "string" };
  }
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    side_effects: skill.side_effects,
    input_schema: { type: "object", required: skill.fields.filter((f) => f.required).map((f) => f.name), properties },
    output_schema: { type: "object", properties: outputs },
  };
}

function render(template: string, input: Record<string, unknown>, encode = false): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const v = input[key];
    const s = v === undefined || v === null ? "" : String(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

const STEP_TIMEOUT_MS = 6_000;

/** Read an HTML table into rows keyed by its header cells. */
async function readTable(page: Page, selector: string): Promise<Record<string, string>[]> {
  return page.locator(selector).first().evaluate((table) => {
    const t = table as HTMLTableElement;
    const head = [...t.querySelectorAll("thead th, tr:first-child th")].map((th) => th.textContent?.trim() ?? "");
    const keys = head.map((h, i) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `col_${i + 1}`);
    const rows = [...t.querySelectorAll("tbody tr, tr")].filter((tr) => tr.querySelector("td"));
    return rows.map((tr) => Object.fromEntries([...tr.querySelectorAll("td")].map((td, i) => [keys[i] ?? `col_${i + 1}`, td.textContent?.trim() ?? ""])));
  });
}

/**
 * Run a skill in a fresh browser context: no cookies, no stored state, nothing shared between runs.
 * Every page must stay on the target's origin; a step that leads elsewhere stops the run.
 */
export async function runSkill(browser: Browser, origin: string, skill: Skill, rawInput: unknown): Promise<Record<string, unknown>> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  const output: Record<string, unknown> = {};
  const stayHome = () => {
    if (page.url() !== "about:blank" && new URL(page.url()).origin !== origin) throw new Error(`the page left ${origin} (now on ${new URL(page.url()).origin})`);
  };
  try {
    for (const [i, s] of skill.steps.entries()) {
      try {
        switch (s.op) {
          case "goto": {
            const url = new URL(render(s.url, input, true), origin);
            if (url.origin !== origin) throw new Error(`goto ${url.origin} is outside ${origin}`);
            await page.goto(url.href, { waitUntil: "load" });
            break;
          }
          case "fill":
            await page.fill(s.selector, render(s.value, input));
            break;
          case "check": {
            const v = render(s.value, input);
            if (v && v !== "false") await page.check(s.selector);
            else await page.uncheck(s.selector);
            break;
          }
          case "click":
            await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: STEP_TIMEOUT_MS }).catch(() => {}), page.click(s.selector)]);
            break;
          case "extract":
            if (s.kind === "url") output[s.field] = page.url();
            else if (s.kind === "table") output[s.field] = await readTable(page, s.selector);
            else if (s.kind === "list") output[s.field] = (await page.locator(s.selector).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
            else output[s.field] = (await page.locator(s.selector).first().innerText()).trim();
            break;
        }
        stayHome();
      } catch (e) {
        const what = s.op === "goto" ? s.url : s.selector;
        throw new Error(`step ${i + 1} (${s.op} ${what}) failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
  } finally {
    await context.close();
  }
  return output;
}

/** Check that a skill is well formed before Scout offers it. Returns the problem, or null. */
export function skillProblem(skill: Skill): string | null {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(skill.id)) return `bad id ${skill.id}`;
  if (!skill.title.trim() || !skill.description.trim()) return "missing title or description";
  if (!skill.steps.length || skill.steps[0]!.op !== "goto") return "the first step must open a page";
  const names = new Set(skill.fields.map((f) => f.name));
  for (const f of skill.fields) if (!/^[a-z][a-z0-9_]*$/.test(f.name)) return `bad field name ${f.name}`;
  for (const s of skill.steps) {
    for (const m of `${s.url} ${s.value}`.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) if (!names.has(m[1]!)) return `step uses unknown field ${m[1]}`;
    if (s.op !== "goto" && s.op !== "extract" && !s.selector) return `${s.op} step has no selector`;
    if (s.op === "extract" && (!s.field || !s.kind || (s.kind !== "url" && !s.selector))) return "extract step needs a field, a kind and a selector";
  }
  return null;
}

export { fieldKey };
