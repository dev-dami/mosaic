import { describe, expect, test } from "bun:test";
import { capabilityOf, connectTarget, outcomeOf, pickNetwork, siteFromEntries, type RegistryEntry } from "../src/host/agentic/catalog";

const base = "http://localhost:4102";
const entry = (over: Partial<RegistryEntry>): RegistryEntry => ({
  ref: `${base}/tagforge#${over.name ?? "x"}`,
  name: "x",
  description: "d",
  inputSchema: { type: "object", properties: {} },
  effect: "read",
  availability: "bridge",
  base,
  network: "tagforge",
  ...over,
});

describe("connectTarget", () => {
  test("a bare origin has no network name", () => {
    expect(connectTarget("localhost:4102")).toEqual({ origin: base, network: undefined });
    expect(connectTarget("http://localhost:4102/")).toEqual({ origin: base, network: undefined });
  });
  test("a path names the network exactly", () => {
    expect(connectTarget("http://localhost:4102/wrongname")).toEqual({ origin: base, network: "wrongname" });
  });
  test("search text is not a target", () => {
    expect(connectTarget("publish release")).toBeNull();
  });
});

describe("pickNetwork", () => {
  const manifest = { networks: [{ name: "tagforge" }] };
  test("an exact name is taken, a wrong one fails closed", () => {
    expect(pickNetwork(manifest, "tagforge", "localhost:4102")).toEqual({ name: "tagforge" });
    expect(() => pickNetwork(manifest, "wrongname", "localhost:4102")).toThrow("No published network named 'wrongname' at localhost:4102");
  });
  test("with no name, one network is taken and several are a choice", () => {
    expect(pickNetwork(manifest, undefined, "h")).toEqual({ name: "tagforge" });
    expect(pickNetwork({ networks: [{ name: "a" }, { name: "b" }] }, undefined, "h")).toEqual({ choices: ["a", "b"] });
  });
});

describe("capabilityOf", () => {
  test("a write keeps its own output fields, not ok and reason", () => {
    const cap = capabilityOf(
      entry({
        name: "publish-release",
        effect: "irreversible",
        inputSchema: { type: "object", title: "Publish release", properties: { version: { type: "string" } } },
        outputSchema: { type: "object", properties: { url: { type: "string" }, ok: { type: "boolean" }, reason: { type: "string" } } },
      }),
    );
    expect(cap).toMatchObject({ id: "publish-release", title: "Publish release", side_effects: "write" });
    expect(cap.input_schema.title).toBeUndefined();
    expect(Object.keys(cap.output_schema.properties ?? {})).toEqual(["url"]);
  });
  test("a title falls back to the name", () => {
    expect(capabilityOf(entry({ name: "list-releases" })).title).toBe("List releases");
  });
});

describe("siteFromEntries", () => {
  test("only this network's entries, with the manifest's theme and agent", () => {
    const other = entry({ name: "y", ref: "http://localhost:9/other#y", base: "http://localhost:9", network: "other" });
    const site = siteFromEntries([entry({ name: "list-releases" }), other], {
      origin: base,
      network: "tagforge",
      manifest: { brand: "Tagforge", theme: { primary: "#9b7bff" }, networks: [{ name: "tagforge", description: "Releases" }], x_mosaic: { agent: { name: "Scout", drives: "http://c", learned_by: "rules" } } },
    });
    expect(site.site).toEqual({ name: "Tagforge", origin: base, description: "Releases", theme_color: "#9b7bff", agent: { name: "Scout", drives: "http://c", learned_by: "rules" } });
    expect(site.url).toBe(`${base}/tagforge`);
    expect(site.capabilities.map((c) => c.id)).toEqual(["list-releases"]);
    expect(site.refs["list-releases"]).toBe(`${base}/tagforge#list-releases`);
  });
});

describe("outcomeOf", () => {
  test("a write that succeeded with ok is published", () => {
    expect(outcomeOf({ action: "r", requestId: "i:0", status: "succeeded", result: { ok: true, url: "/releases/v1.0" } })).toEqual({ kind: "done", output: { url: "/releases/v1.0" }, requestId: "i:0" });
  });
  test("ok:false denied is denied; another reason failed", () => {
    expect(outcomeOf({ action: "r", status: "succeeded", result: { ok: false, reason: "denied" } }).kind).toBe("denied");
    expect(outcomeOf({ action: "r", status: "succeeded", result: { ok: false, reason: "version exists" } })).toMatchObject({ kind: "failed", message: "version exists" });
  });
  test("unknown is never a failure to retry", () => {
    expect(outcomeOf({ action: "r", requestId: "i:0", status: "unknown", error: "Action bridge closed; outcome unknown." })).toMatchObject({ kind: "unknown", requestId: "i:0" });
  });
  test("a window cancelled before it opened did not start", () => {
    expect(outcomeOf({ action: "r", status: "unknown", error: "Action window cancelled; action not started." }).kind).toBe("not_started");
    expect(outcomeOf({ action: "r", status: "not_started" }).kind).toBe("not_started");
  });
  test("a read's result is its output", () => {
    expect(outcomeOf({ action: "r", status: "succeeded", result: { releases: [] } }, "read")).toEqual({ kind: "done", output: { releases: [] }, requestId: undefined });
  });
});
