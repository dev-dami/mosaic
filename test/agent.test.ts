// Scout's learner and runner against Corkboard, a site with no manifest, in a real headless browser.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright-core";
import { learnHeuristic } from "../agent/learn-heuristic";
import { observe } from "../agent/observe";
import { runSkill, skillProblem, toCapability, type Skill } from "../agent/skill";
import { corkboardFetch } from "../providers/corkboard";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let origin: string;
let skills: Skill[];
const byId = (id: string) => skills.find((s) => s.id === id)!;

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: corkboardFetch });
  origin = `http://localhost:${server.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
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

  test("a learned read runs and returns the page's data", async () => {
    const out = await runSkill(browser, origin, byId("search-threads"), { q: "safari" });
    expect(out.results).toEqual([{ thread: "Connect button does nothing on Safari 18", author: "tomasz_k", replies: "2", status: "open" }]);
  }, 20_000);

  test("a learned write changes the site", async () => {
    const out = await runSkill(browser, origin, byId("reply-to-a-thread"), { thread_id: "1", author: "scout-test", body: "Reply from a test" });
    expect(String(out.url)).toContain(`${origin}/thread/1`);
    const thread = await runSkill(browser, origin, byId("read-thread"), { thread_id: "1" });
    expect((thread.posts as string[]).at(-1)).toContain("Reply from a test");
  }, 20_000);

  test("a script cannot leave the site it drives", async () => {
    const escape: Skill = { ...byId("read-threads"), steps: [{ op: "goto", url: "https://example.com/", selector: "", value: "", field: "", kind: "" }] };
    await expect(runSkill(browser, origin, escape, {})).rejects.toThrow(/outside/);
  });
});
