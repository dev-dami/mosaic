import { describe, expect, test } from "bun:test";
import { applyRecipe, buildRecipe, decodeRecipe, encodeRecipe, MAX_NETWORKS, MAX_RECIPE_BYTES, parseRecipe, recipeFromHash, recipeLink, type Recipe } from "../src/host/recipe";

const adapter = {
  mosaic: "adapter/0",
  target: { origin: "http://localhost:4120", name: "Forum" },
  learned: { by: "rules", at: "2026-11-01T00:00:00.000Z" },
  skills: [{ id: "post", title: "Post", description: "d", side_effects: "write", fields: [], steps: [] }],
};

const conn = (url: string, agent = false) => {
  const u = new URL(url);
  return { key: 1, status: "ready", site: { network: u.pathname.slice(1), url, capabilities: [], refs: {}, site: { name: "S", origin: u.origin, ...(agent ? { agent: { name: "Scout", drives: "http://localhost:4120", learned_by: "rules" } } : {}) } } };
};

/** A workspace the way the store holds it after a BYOK profile was saved and steps ran. */
const state = {
  title: "Launch Lumen v1.0",
  conns: [conn("http://localhost:4102/tagforge"), conn("http://localhost:4201/forum", true)],
  manual: { k1: { notes: "SECRET_INPUT_VALUE" } },
  runs: { k1: { status: "done", output: "SECRET_RESULT_VALUE", at: new Date() } },
  profile: { key: "otk_test123", router: "http://localhost:9999/v1", model: "mock-model" },
} as never;

const client = {
  templates: async () => [{ id: "forum", origin: "http://localhost:4201" }],
  adapter: async () => adapter,
  import: async () => ({ id: "forum", origin: "http://localhost:4301" }),
};

describe("recipe/1", () => {
  test("build, link, parse: the same recipe comes back", async () => {
    const r = await buildRecipe(state, "http://localhost:4108", client as never);
    expect(r).toEqual({
      mosaic: "recipe/1",
      outcome: "Launch Lumen v1.0",
      networks: ["http://localhost:4102/tagforge", "http://localhost:4201/forum"],
      adapters: { "http://localhost:4201/forum": adapter },
    });
    const link = await recipeLink(state, "http://localhost:4108", "http://mosaic.test", client as never);
    expect(link.startsWith("http://mosaic.test/#recipe=")).toBe(true);
    expect(recipeFromHash(new URL(link).hash)).toEqual({ recipe: r });
  });

  test("the link carries no key, router, model, input values or results", async () => {
    const link = await recipeLink(state, "http://localhost:4108", "http://mosaic.test", client as never);
    const decoded = JSON.stringify(decodeRecipe(new URL(link).hash.split("recipe=")[1]!));
    for (const secret of ["otk_test123", "localhost:9999", "mock-model", "SECRET_INPUT_VALUE", "SECRET_RESULT_VALUE", "4108"]) {
      expect(link).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  test("no Scout: a learned site goes as its network URL only", async () => {
    const r = await buildRecipe(state, undefined, client as never);
    expect(r.adapters).toBeUndefined();
    expect(r.networks).toHaveLength(2);
  });

  test("malformed links are refused with a plain message", () => {
    expect(recipeFromHash("#recipe=%%%")).toEqual({ error: expect.stringMatching(/not a valid recipe/i) });
    expect(recipeFromHash("#recipe=" + encodeRecipe({ nope: 1 } as never))).toEqual({ error: expect.any(String) });
    expect(recipeFromHash("#nothing")).toBeNull();
  });

  const ok: Recipe = { mosaic: "recipe/1", outcome: "x", networks: ["https://a.example/net"] };
  const bad = (over: object) => () => parseRecipe({ ...ok, ...over });

  test("strict validation", () => {
    expect(parseRecipe(ok)).toEqual(ok);
    expect(bad({ networks: ["javascript:alert(1)"] })).toThrow(/http/);
    expect(bad({ networks: ["data:text/html,x/net"] })).toThrow(/http/);
    expect(bad({ networks: ["ftp://a.example/net"] })).toThrow(/http/);
    expect(bad({ networks: ["https://user:pw@a.example/net"] })).toThrow();
    expect(bad({ networks: ["https://a.example/net?key=1"] })).toThrow();
    expect(bad({ networks: ["https://a.example/"] })).toThrow(/network/);
    expect(bad({ networks: ["https://a.example/a", "https://a.example/b"] })).toThrow(/twice/);
    expect(bad({ networks: Array.from({ length: MAX_NETWORKS + 1 }, (_, i) => `https://s${i}.example/n`) })).toThrow(/20/);
    expect(bad({ outcome: 5 })).toThrow();
    expect(bad({ key: "otk_x" })).toThrow(/key/);
    expect(bad({ adapters: { "https://other.example/n": adapter } })).toThrow();
    expect(bad({ adapters: { "https://a.example/net": { mosaic: "adapter/0", target: { origin: "javascript:x" }, skills: [] } } })).toThrow();
    expect(() => parseRecipe({ mosaic: "recipe/0", outcome: "x", sites: [] })).toThrow(/older Mosaic/);
  });

  test("oversize links are refused", () => {
    const big = encodeRecipe({ ...ok, outcome: "x".repeat(MAX_RECIPE_BYTES) });
    expect(recipeFromHash("#recipe=" + big)).toEqual({ error: expect.stringMatching(/too large/) });
  });
});

describe("applyRecipe", () => {
  test("sets the outcome, imports templates, connects each network URL in order", async () => {
    const calls: string[] = [];
    const actions = { setTitle: (t: string) => calls.push(`title ${t}`), connect: async (u: string) => (calls.push(`connect ${u}`), true) };
    const r = await buildRecipe(state, "http://localhost:4108", client as never);
    const problems = await applyRecipe(r, actions as never, "http://localhost:4109", client as never);
    expect(problems).toEqual([]);
    expect(calls).toEqual(["title Launch Lumen v1.0", "connect http://localhost:4102/tagforge", "connect http://localhost:4301/forum"]);
  });

  test("a template this Scout refuses is surfaced and not connected", async () => {
    const calls: string[] = [];
    const actions = { setTitle: () => {}, connect: async (u: string) => (calls.push(u), true) };
    const refusing = { ...client, import: async () => Promise.reject(new Error("http://localhost:4120 is not in SCOUT_TARGETS")) };
    const r = await buildRecipe(state, "http://localhost:4108", client as never);
    const problems = await applyRecipe(r, actions as never, "http://localhost:4109", refusing as never);
    expect(calls).toEqual(["http://localhost:4102/tagforge"]);
    expect(problems).toEqual([expect.stringMatching(/SCOUT_TARGETS/)]);
    const none = await applyRecipe(r, actions as never, undefined, client as never);
    expect(none).toEqual([expect.stringMatching(/no Scout/)]);
  });
});
