// Scout's learner and runner against Corkboard, a site with no manifest, in a real headless browser,
// then the learned template served as a site and checked the way a caller's runtime checks it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { chromium, type Browser } from "playwright-core";
import { SKILLS_SCHEMA } from "../agent/learn-claude";
import { learnHeuristic } from "../agent/learn-heuristic";
import { observe } from "../agent/observe";
import { adapterSite, runSkill, skillProblem, step, toCapability, verifySkills, type Adapter, type Skill } from "../agent/skill";
import { networkName } from "../providers/agentic";
import { corkboardFetch } from "../providers/corkboard";
import { serveSite } from "../providers/site";
// The vendored runtime is plain JavaScript without types; these are the functions a caller's
// browser runs on what a site publishes.
// @ts-expect-error plain JS module without types
import { checkSchema, validateData } from "../vendor/nsdeploy-runtime/actions.js";
// @ts-expect-error plain JS module without types
import { parseHocon } from "../vendor/nsdeploy-runtime/hocon.js";
// @ts-expect-error plain JS module without types
import { AgentNetwork, validateNetwork } from "../vendor/nsdeploy-runtime/kernel.js";

/** The agentify-website skill's partner check. Not vendored; set CHECK_PARTNER to its path to run it here. */
const CHECK_PARTNER = process.env.CHECK_PARTNER ?? "/tmp/claude-probe-aw/agentic-web/skills/agentify-website/scripts/check_partner.mjs";
const HOST = "http://localhost:4000";

/**
 * CHROMIUM_PATH, else any Chromium Playwright already downloaded. playwright-core's own default is
 * the headless shell of its exact version, which a newer playwright-core may not have downloaded.
 */
function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const found = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  return found.map((d) => join(cache, d, "chrome-linux64", "chrome")).find((p) => existsSync(p));
}

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let origin: string;
let skills: Skill[];
const byId = (id: string) => skills.find((s) => s.id === id)!;

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: corkboardFetch });
  origin = `http://localhost:${server.port}`;
  browser = await chromium.launch({ executablePath: chromiumPath() });
  skills = learnHeuristic(await observe(browser, origin));
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

describe("Scout, rules learner", () => {
  test("learns the forum's tables, search, thread page and both forms", () => {
    expect(skills.map((s) => `${s.id}:${s.side_effects}`).sort()).toEqual(
      ["read-thread:read", "read-threads:read", "reply-to-a-thread:write", "search-threads:read", "start-a-thread:write"].sort(),
    );
    for (const s of skills) expect(skillProblem(s)).toBeNull();
  });

  test("turns an id in the path into a required field, with the id it saw", () => {
    const reply = byId("reply-to-a-thread");
    expect(reply.steps[0]).toMatchObject({ op: "goto", url: "/thread/{{thread_id}}" });
    expect(reply.fields.find((f) => f.name === "thread_id")).toMatchObject({ required: true, example: "1" });
    expect(toCapability(reply).input_schema.required).toEqual(["thread_id", "author", "body"]);
  });

  test("the runtime's checkSchema accepts every input and output schema Scout writes", () => {
    for (const s of skills) {
      const cap = toCapability(s);
      expect(() => checkSchema(cap.input_schema), `${s.id} input`).not.toThrow();
      expect(() => checkSchema(cap.output_schema), `${s.id} output`).not.toThrow();
    }
  });

  // Claude writes skills in the rules learner's shape (SKILLS_SCHEMA), and toCapability builds the
  // schemas from fields and steps alone, so what Claude writes stays inside the runtime's subset too.
  test("the rules draft fits Claude's structured output schema, and odd model output still yields checkSchema-safe schemas", () => {
    const validate = new Ajv({ strict: false }).compile(SKILLS_SCHEMA);
    const draft = JSON.parse(JSON.stringify({ skills: skills.map(({ verified: _v, ...s }) => s) }));
    expect(validate(draft), JSON.stringify(validate.errors)).toBe(true);
    const odd: Skill = {
      id: "list-everything",
      title: "List everything",
      description: "Reads every table and list on the front page.",
      side_effects: "read",
      fields: [{ name: "note", label: "Note", type: "text", required: false, example: "" }, { name: "all", label: "All", type: "boolean", required: false, example: "" }],
      steps: [
        step({ op: "goto", url: "/" }),
        step({ op: "extract", field: "rows", selector: "table", kind: "table", columns: ["", "Thread", "Thread", "Last reply (UTC)"] }),
        step({ op: "extract", field: "cells", selector: "table", kind: "table" }),
        step({ op: "extract", field: "links", selector: "a", kind: "list" }),
        step({ op: "extract", field: "where", kind: "url" }),
      ],
    };
    expect(skillProblem(odd)).toBeNull();
    const cap = toCapability(odd);
    expect(() => checkSchema(cap.input_schema)).not.toThrow();
    expect(() => checkSchema(cap.output_schema)).not.toThrow();
    expect(Object.keys(cap.output_schema.properties!.rows!.items!.properties!)).toEqual(["col_1", "thread", "last_reply_utc"]);
    expect(skillProblem({ ...odd, steps: [odd.steps[0]!, { ...odd.steps[1]!, field: "__proto__" }] })).toMatch(/bad output field/);
  });

  test("a table read names its columns, so the runtime can check each row", () => {
    expect(toCapability(byId("read-threads")).output_schema.properties!.threads).toMatchObject({
      type: "array",
      items: { type: "object", properties: { thread: { type: "string" }, author: { type: "string" }, replies: { type: "string" }, status: { type: "string" } } },
    });
  });

  test("a learned read runs and returns the page's data", async () => {
    const out = await runSkill(browser, origin, byId("search-threads"), { q: "safari" });
    expect(out.results).toEqual([{ thread: "Connect button does nothing on Safari 18", author: "tomasz_k", replies: "2", status: "open" }]);
  }, 20_000);

  // The runtime validates every result against outputSchema and refuses keys it does not list.
  test("every learned read's real output passes the runtime's validateData", async () => {
    const inputs: Record<string, Record<string, string>> = { "read-threads": {}, "search-threads": { q: "safari" }, "read-thread": { thread_id: "3" } };
    for (const [id, input] of Object.entries(inputs)) {
      const out = await runSkill(browser, origin, byId(id), input);
      expect(() => validateData(toCapability(byId(id)).output_schema, out, "result"), id).not.toThrow();
    }
  }, 30_000);

  test("a table with no known columns returns rows of cells, which still validate", async () => {
    const plain: Skill = { ...byId("read-threads"), steps: byId("read-threads").steps.map((s) => ({ ...s, columns: [] })) };
    const out = await runSkill(browser, origin, plain, {});
    expect((out.threads as string[][])[0]).toEqual(["Connect button does nothing on Safari 18", "tomasz_k", "2", "open"]);
    expect(() => validateData(toCapability(plain).output_schema, out, "result")).not.toThrow();
  }, 20_000);

  test("a learned write changes the site", async () => {
    const out = await runSkill(browser, origin, byId("reply-to-a-thread"), { thread_id: "1", author: "scout-test", body: "Reply from a test" });
    expect(String(out.url)).toContain(`${origin}/thread/1`);
    const thread = await runSkill(browser, origin, byId("read-thread"), { thread_id: "1" });
    expect((thread.posts as string[]).at(-1)).toContain("Reply from a test");
  }, 20_000);

  test("a script cannot leave the site it drives", async () => {
    const escape: Skill = { ...byId("read-threads"), steps: [{ op: "goto", url: "https://example.com/", selector: "", value: "", field: "", kind: "", columns: [] }] };
    await expect(runSkill(browser, origin, escape, {})).rejects.toThrow(/outside/);
    // Refused before any browser context opens: a browser that cannot open one is never asked.
    const noBrowser = { newContext: () => Promise.reject(new Error("opened a context")) } as unknown as Browser;
    await expect(runSkill(noBrowser, origin, escape, {})).rejects.toThrow(/step 1 \(goto https:\/\/example.com\/\) failed: goto https:\/\/example.com is outside/);
  }, 20_000);
});

describe("a Scout-served template conforms to MVP profile 0.3", () => {
  let site: ReturnType<typeof serveSite>;
  let at: string;
  let adapter: Adapter;
  let network: string;

  beforeAll(async () => {
    const verified = await verifySkills(browser, origin, skills);
    adapter = { mosaic: "adapter/0", target: { origin, name: "Corkboard", theme_color: "#a0662b" }, learned: { by: "rules", at: new Date().toISOString() }, skills: verified };
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    process.env.MOSAIC_HOSTS = HOST;
    at = `http://localhost:${port}`;
    site = serveSite(adapterSite(adapter, async () => browser), { port, origin: at });
    network = networkName(adapterSite(adapter, async () => browser));
  }, 40_000);

  afterAll(() => site?.stop(true));

  const json = async (path: string) => {
    const res = await fetch(`${at}${path}`, { headers: { origin: HOST } });
    expect(res.status, path).toBe(200);
    return res.json() as Promise<any>;
  };

  test("verifying keeps every read it could run and marks it verified", () => {
    expect(adapter.skills.filter((s) => s.verified).map((s) => s.id).sort()).toEqual(["read-thread", "read-threads", "search-threads"]);
    expect(adapter.skills.filter((s) => s.side_effects === "write").every((s) => s.verified === false)).toBe(true);
  });

  test("agent-manifest.json says Scout performs the actions on a site that did not publish them", async () => {
    const manifest = await json("/agent-manifest.json");
    expect(manifest).toMatchObject({
      brand: "Corkboard",
      networks: [{ name: network, hocon: `./${network}.network.json` }],
      actions: { version: 1, bridge: "./bridge/action-bridge.html", agentTools: adapter.skills.map((s) => s.id) },
      x_mosaic: { agent: { name: "Scout", drives: origin, learned_by: "rules" } },
    });
  });

  test("the network file passes the runtime's validateNetwork and its front agent names Scout", async () => {
    const file = await json(`/${network}.network.json`);
    const net = new AgentNetwork(parseHocon(JSON.stringify(file)), network);
    expect(validateNetwork(net).errors).toEqual([]);
    expect(file.tools[0].instructions).toContain(`The agent Scout performs them in a browser on ${origin}`);
  });

  test("links.json and the bridge's manifest are served", async () => {
    expect(await json("/links.json")).toEqual({ version: 1, networks: { [network]: {} } });
    expect(await json("/bridge/agent-manifest.json")).toMatchObject({ networks: [{ name: network }], actions: { version: 1 } });
    expect((await fetch(`${at}/bridge/action-bridge.html`)).status).toBe(200);
    expect((await json("/bridge/bridge-config.json")).agent).toEqual({ name: "Scout", drives: origin, learned_by: "rules" });
  });

  test("a read through the site's API returns data that passes validateData", async () => {
    const res = await fetch(`${at}/api/capabilities/search-threads`, { method: "POST", headers: { origin: at, "content-type": "application/json" }, body: JSON.stringify({ q: "dark" }) });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.results).toEqual([{ thread: "Feature request: dark approval sheets", author: "ines.r", replies: "0", status: "open" }]);
    expect(() => validateData(toCapability(byId("search-threads")).output_schema, out, "result")).not.toThrow();
  }, 20_000);

  test("a write's sheet in the bridge window carries the Scout agent note", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${at}/`);
      const text = await page.evaluate(async (host) => {
        const config = await (await fetch("/bridge/bridge-config.json")).json();
        const actionsModule = "/bridge/bridge-actions.js"; // the bundle the bridge window loads
        const { browserDeps } = await import(actionsModule);
        const write = config.capabilities.find((c: { side_effects: string }) => c.side_effects === "write");
        void browserDeps(config).ask(write, { thread_id: "1", author: "a", body: "b" }, host);
        return document.body.innerText;
      }, HOST);
      const host = new URL(origin).host;
      expect(text).toContain(`Scout will do this in a browser on ${host}.`);
      expect(text).toContain(`${host} did not publish this action`);
    } finally {
      await page.close();
    }
  }, 20_000);

  test.skipIf(!existsSync(CHECK_PARTNER))("the agentify-website skill's check_partner.mjs passes it", async () => {
    const proc = Bun.spawn(["node", CHECK_PARTNER, `${at}/${network}`, "--origin", HOST], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(out).not.toContain("ERROR");
    expect(code, out).toBe(0);
  }, 30_000);
});
