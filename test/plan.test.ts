import { describe, expect, test } from "bun:test";
import type { Capability, JsonSchema } from "../src/protocol";
import { capKey, parseOutcome, type CapRef } from "../src/host/doc";
import { analyzeOutcome, planWorkspace, terms } from "../src/host/entry/plan";

const S = (type = "string"): JsonSchema => ({ type }) as JsonSchema;
const cap = (id: string, title: string, description: string, side_effects: "read" | "write", input: Record<string, JsonSchema>, output: Record<string, JsonSchema> = {}): Capability => ({
  id,
  title,
  description,
  side_effects,
  input_schema: { type: "object", properties: input },
  output_schema: { type: "object", properties: output },
});

const D = "http://docs.example";
const R = "http://releases.example";
const A = "http://announce.example";
const sites: [string, Capability[]][] = [
  [
    D,
    [
      cap("preview-docs-update", "Preview docs update", "Show the documentation change a release needs, without changing anything.", "read", { version: S(), summary: S() }, { path: S(), before: S(), after: S() }),
      cap("apply-docs-update", "Apply docs update", "Publish the documentation change for a release.", "write", { version: S(), summary: S() }),
    ],
  ],
  [
    R,
    [
      cap("list-releases", "List releases", "List the published releases, newest first.", "read", {}),
      cap("draft-changelog", "Draft changelog", "Write release notes from a list of highlights. Publishes nothing.", "read", { version: S(), highlights: { type: "array", items: S() } as JsonSchema }, { notes: S() }),
      cap("publish-release", "Publish release", "Publish a release with its notes.", "write", { version: S(), notes: S(), prerelease: S("boolean") }),
    ],
  ],
  [
    A,
    [
      cap("draft-announcement", "Draft announcement", "Write a launch post from a release. Posts nothing.", "read", { project: S(), version: S(), notes: S(), tone: { type: "string", enum: ["plain"] } as JsonSchema }, { text: S() }),
      cap("schedule-announcement", "Schedule announcement", "Schedule a launch post.", "write", { text: S(), post_at: S() }),
    ],
  ],
];
const refs: CapRef[] = sites.flatMap(([origin, caps], si) => caps.map((c, i) => ({ key: capKey(origin, c.id), origin, siteName: origin, cap: c, order: si * 100 + i })));
const order = [D, R, A];
const plan = (outcome: string, r = refs, o = order) => planWorkspace({ outcome, refs: r, siteOrder: o });
const shown = (p: ReturnType<typeof plan>) => refs.filter((r) => !p.hidden.has(r.key)).map((r) => r.cap.id);

describe("outcome properties", () => {
  test("task words are not read as the project", () => {
    expect(parseOutcome("Update the docs for v2.1")).toEqual({ project: undefined, version: "v2.1" });
    expect(parseOutcome("Announce Atlas v3.0")).toEqual({ project: "Atlas", version: "v3.0" });
    expect(parseOutcome("Publish release v1.0")).toEqual({ project: undefined, version: "v1.0" });
  });
});

describe("outcome plan", () => {
  test("terms drop stopwords and versions and stem plurals", () => {
    expect(terms("Publish the release notes for v1.0")).toEqual(["publish", "release", "note"]);
  });

  test("a launch keeps every step of a release in dependency order", () => {
    const p = plan("Launch Lumen v1.0");
    expect(p.hidden.size).toBe(0);
    expect(p.siteOrder).toEqual(order);
  });

  test("an empty outcome or one that matches nothing keeps everything", () => {
    expect(plan("").hidden.size).toBe(0);
    expect(plan("Water the plants").hidden.size).toBe(0);
    expect(analyzeOutcome("Water the plants", refs).mode).toBe("all");
  });

  test("a docs outcome picks only the docs site and puts it first", () => {
    const p = plan("Update the docs for v2.1", refs, [R, A, D]);
    expect(shown(p)).toEqual(["preview-docs-update", "apply-docs-update"]);
    expect(p.siteOrder[0]).toBe(D);
  });

  test("an announcement pulls in the changelog it reads from, which comes first", () => {
    const p = plan("Announce Atlas v3.0");
    expect(shown(p)).toEqual(["list-releases", "draft-changelog", "draft-announcement", "schedule-announcement"]);
    expect(p.siteOrder.indexOf(R)).toBeLessThan(p.siteOrder.indexOf(A));
    expect(p.siteOrder.at(-1)).toBe(D);
  });

  test("mention order wins where data allows: docs before the announcement", () => {
    const p = plan("Update docs, then announce v2.0");
    expect(p.siteOrder).toEqual([D, R, A]);
    const q = plan("Announce v2.0 and update docs");
    expect(q.siteOrder.indexOf(D)).toBe(2);
  });

  test("every origin appears exactly once and the plan is deterministic", () => {
    for (const o of ["Release v1.2", "Draft the changelog", "Ship it", "Post on the blog"]) {
      const p = plan(o);
      expect([...p.siteOrder].sort()).toEqual([...order].sort());
      expect(plan(o)).toEqual(p);
    }
  });

  test("an unknown site with no title match falls back to descriptions", () => {
    const X = "https://billing.example";
    const x: CapRef[] = [{ key: capKey(X, "make-invoice"), origin: X, siteName: "Billing", order: 0, cap: cap("make-invoice", "Make invoice", "Bill a customer for a month of usage.", "write", { customer: S() }) }];
    const a = analyzeOutcome("Bill Acme for March", x);
    expect(a.mode).toBe("matched");
    expect(a.picked.get(capKey(X, "make-invoice"))?.kind).toBe("described");
  });
});
