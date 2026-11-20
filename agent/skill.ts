// A learned skill: one thing a site's pages can do, written as a short browser script. Scout writes
// skills by looking at a site (agent/learn-*.ts), saves them in an adapter file, and runs them here.
// An adapter (mosaic-adapter/0, Scout's own save format) is a template for a site that publishes
// no agent files. It holds the skills and the steps that perform each one, so any Scout can load
// it. adapterSite turns it into a SiteDefinition, and serveSite publishes the MVP profile 0.3 files
// from that: agent-manifest.json with x_mosaic.agent, the Neuro SAN network, links.json and the
// nsdeploy action bridge. Every schema here stays inside the runtime's checkSchema subset
// (vendor/nsdeploy-runtime/actions.js): objects list their properties, arrays their items.
import type { Browser, Page } from "playwright-core";
import type { SiteDefinition } from "../providers/site";
import type { Capability, JsonSchema } from "../src/protocol";
import { fencedPage } from "./targets";

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
 *   For a table, `columns` names its header cells; each row is then an object with those keys.
 *   With no columns, each row is a list of cell texts.
 */
export type Step = { op: StepOp; selector: string; value: string; url: string; field: string; kind: ExtractKind | ""; columns: string[] };

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

export const step = (s: Partial<Step> & { op: StepOp }): Step => ({ selector: "", value: "", url: "", field: "", kind: "", columns: [], ...s });

export const slug = (s: string, max = 40) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "skill";

const fieldKey = (s: string) => slug(s).replace(/-/g, "_");

/** A table header cell as a row key: "Last reply" -> "last_reply"; a blank header -> "col_<n>". */
export const columnKey = (header: string, i: number) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || `col_${i + 1}`;

/** A table step's row keys, unique and in order. Adapters saved before columns existed have none. */
function rowKeys(s: Step): string[] {
  return [...new Set((s.columns ?? []).map(columnKey))];
}

function extractSchema(s: Step): JsonSchema {
  if (s.kind === "list") return { type: "array", items: { type: "string" } };
  if (s.kind !== "table") return { type: "string" };
  const keys = rowKeys(s);
  if (!keys.length) return { type: "array", items: { type: "array", items: { type: "string" } } };
  return { type: "array", items: { type: "object", required: keys, properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])) } };
}

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
    outputs[s.field] = extractSchema(s);
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

/**
 * Read an HTML table. With columns, each row is an object with exactly those keys (a missing cell is
 * ""), so it matches the output schema; a table that has none of the columns fails the step.
 * Without columns, each row is its list of cell texts.
 */
async function readTable(page: Page, s: Step): Promise<Record<string, string>[] | string[][]> {
  const { head, rows } = await page
    .locator(s.selector)
    .first()
    .evaluate((table) => {
      const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const head = [...table.querySelectorAll("thead th, tr:first-child th")].map(text);
      const rows = [...table.querySelectorAll("tbody tr, tr")].filter((tr) => tr.querySelector("td")).map((tr) => [...tr.querySelectorAll("td")].map(text));
      return { head, rows };
    });
  const keys = rowKeys(s);
  if (!keys.length) return rows;
  const index = new Map(head.map((h, i) => [columnKey(h, i), i]));
  if (!keys.some((k) => index.has(k))) throw new Error(`the table has none of the columns ${keys.join(", ")} (it has ${head.join(", ") || "no header"})`);
  return rows.map((cells) => Object.fromEntries(keys.map((k) => [k, cells[index.get(k) ?? -1] ?? ""])));
}

/**
 * Run a skill in a fresh browser context: no cookies, no stored state, nothing shared between runs.
 * Every page must stay on the target's origin; a step that leads elsewhere stops the run.
 */
export async function runSkill(browser: Browser, origin: string, skill: Skill, rawInput: unknown): Promise<Record<string, unknown>> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  // The fence fails any request to another origin before it is sent, redirect hops included.
  const { context, page } = await fencedPage(browser, origin);
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
            else if (s.kind === "table") output[s.field] = await readTable(page, s);
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
    if (s.op === "extract" && !/^[a-z][a-z0-9_]*$/.test(s.field)) return `bad output field ${s.field}`;
    if (s.columns !== undefined && (!Array.isArray(s.columns) || s.columns.some((c) => typeof c !== "string"))) return "columns must be a list of header names";
  }
  return null;
}

/**
 * Run each read that can run with the values Scout saw while learning. A read that fails is
 * dropped; a read that needs a value Scout never saw is kept unverified. Writes are never run here.
 */
export async function verifySkills(browser: Browser, origin: string, skills: Skill[], log: (m: string) => void = console.log): Promise<Skill[]> {
  const kept: Skill[] = [];
  for (const skill of skills) {
    if (skillProblem(skill)) continue;
    if (skill.side_effects === "write" || skill.fields.some((f) => f.required && !f.example)) {
      kept.push({ ...skill, verified: false });
      continue;
    }
    try {
      await runSkill(browser, origin, skill, Object.fromEntries(skill.fields.map((f) => [f.name, f.example])));
      kept.push({ ...skill, verified: true });
    } catch (e) {
      log(`Scout dropped "${skill.title}": ${e instanceof Error ? e.message : e}`);
    }
  }
  return kept;
}

/**
 * A template as a site. serveSite publishes its agent files from this, and x_mosaic.agent in the
 * manifest says that Scout, not the target, performs every action. The bridge config carries the
 * same agent, so a write's approval sheet says Scout will do it on a site that did not publish it.
 */
export function adapterSite(adapter: Adapter, browserFor: () => Promise<Browser>): SiteDefinition {
  const host = new URL(adapter.target.origin).host;
  return {
    name: adapter.target.name,
    description: `Learned by Scout from ${host}. ${host} did not publish these; Scout performs them in a browser.`,
    port: 0,
    look: { scheme: "light", accent: adapter.target.theme_color ?? "#5b6472", font: "mono" },
    agent: { name: "Scout", drives: adapter.target.origin, learned_by: adapter.learned.by },
    capabilities: adapter.skills.map((skill) => ({ ...toCapability(skill), run: async (input: unknown) => runSkill(await browserFor(), adapter.target.origin, skill, input) })),
  };
}

export { fieldKey };
