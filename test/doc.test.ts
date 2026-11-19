import { describe, expect, test } from "bun:test";
import type { Capability, JsonSchema } from "../src/protocol";
import { autoBinding, capKey, diffLines, hueOf, monogram, orderSites, parseInline, parseMarkdown, parseOutcome, resolve, type CapRef, type Lookup } from "../src/host/doc";

const cap = (id: string, side_effects: "read" | "write", input: Record<string, JsonSchema>, output: Record<string, JsonSchema> = {}): Capability => ({
  id,
  title: id,
  description: id,
  side_effects,
  input_schema: { type: "object", properties: input },
  output_schema: { type: "object", properties: output },
});
const ref = (origin: string, c: Capability, order: number): CapRef => ({ key: capKey(origin, c.id), origin, siteName: origin, cap: c, order });

const R = "https://releases.example";
const A = "https://announce.example";
const draft = ref(R, cap("draft-changelog", "read", { version: { type: "string" }, highlights: { type: "array", items: { type: "string" } } }, { notes: { type: "string" } }), 0);
const publish = ref(R, cap("publish-release", "write", { version: { type: "string" }, notes: { type: "string" }, prerelease: { type: "boolean" } }), 1);
const announce = ref(A, cap("draft-announcement", "read", { notes: { type: "string" }, tone: { type: "string", enum: ["plain"] } }, { text: { type: "string" } }), 2);
const schedule = ref(A, cap("schedule", "write", { text: { type: "string" } }), 3);
const all = [draft, publish, announce, schedule];

describe("provenance", () => {
  test("hue is stable per origin and differs between origins", () => {
    expect(hueOf(R)).toBe(hueOf(R));
    expect(hueOf(R)).not.toBe(hueOf(A));
    expect(hueOf(R)).toBeGreaterThanOrEqual(0);
    expect(hueOf(R)).toBeLessThan(360);
  });

  test("monogram skips filler words", () => {
    expect(monogram("Demo Releases")).toBe("R");
    expect(monogram("tagforge")).toBe("T");
  });
});

describe("outcome", () => {
  test("reads project and version from the sentence", () => {
    expect(parseOutcome("Launch Lumen v1.0")).toEqual({ project: "Lumen", version: "v1.0" });
    expect(parseOutcome("Ship 2.1 of acme/widget")).toEqual({ project: "acme/widget", version: "v2.1" });
    expect(parseOutcome("")).toEqual({ project: undefined, version: undefined });
  });
});

describe("markdown and diff", () => {
  test("parses headings, lists and paragraphs", () => {
    expect(parseMarkdown("## v1.0\n\n- One\n- Two\n\nDone.")).toEqual([
      { t: "h", level: 2, text: "v1.0" },
      { t: "ul", items: ["One", "Two"] },
      { t: "p", text: "Done." },
    ]);
    expect(parseInline("use `x` **now**")).toEqual([
      { t: "text", text: "use " },
      { t: "code", text: "x" },
      { t: "text", text: " " },
      { t: "strong", text: "now" },
    ]);
  });

  test("diffs lines", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "B" },
      { op: " ", text: "c" },
      { op: "+", text: "d" },
    ]);
  });
});

describe("data flow", () => {
  const docProps = { version: "v1.0", project: "Lumen" };

  test("binds a field to a document property by name", () => {
    expect(autoBinding(draft, "version", all, docProps)).toEqual({ kind: "prop", key: "version" });
  });

  test("binds a field to another site's output of the same name", () => {
    expect(autoBinding(announce, "notes", all, docProps)).toEqual({ kind: "output", cap: draft.key, field: "notes" });
    expect(autoBinding(publish, "notes", all, docProps)).toEqual({ kind: "output", cap: draft.key, field: "notes" });
    expect(autoBinding(schedule, "text", all, docProps)).toEqual({ kind: "output", cap: announce.key, field: "text" });
  });

  test("a write mirrors the same field of a read on its own site", () => {
    const preview = ref(R, cap("preview", "read", { summary: { type: "string" } }), 4);
    const apply = ref(R, cap("apply", "write", { summary: { type: "string" } }), 5);
    expect(autoBinding(apply, "summary", [preview, apply], {})).toEqual({ kind: "mirror", cap: preview.key, field: "summary" });
  });

  test("never binds enums or booleans", () => {
    expect(autoBinding(announce, "tone", all, { tone: "plain" })).toBeNull();
    expect(autoBinding(publish, "prerelease", all, { prerelease: "x" })).toBeNull();
  });

  test("resolves a binding to a value once the producing block has run", () => {
    const outputs = new Map<string, unknown>();
    const lookup: Lookup = { binding: () => null, manual: () => undefined, output: (k) => outputs.get(k), docProps };
    const b = { kind: "output", cap: draft.key, field: "notes" } as const;
    expect(resolve(b, lookup)).toEqual({ state: "pending", from: draft.key });
    outputs.set(draft.key, { notes: "## v1.0" });
    expect(resolve(b, lookup)).toEqual({ state: "value", value: "## v1.0" });
  });

  test("orders a consuming site after the site it reads from", () => {
    const deps: Record<string, string[]> = { docs: ["rel"], rel: [], ann: ["rel"] };
    expect(orderSites(["docs", "rel", "ann"], (o) => new Set(deps[o]))).toEqual(["rel", "docs", "ann"]);
  });
});
