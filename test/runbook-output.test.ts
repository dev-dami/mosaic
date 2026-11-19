import { describe, expect, test } from "bun:test";
import { diffRows, humanKey, summarize } from "../src/host/runbook/output";

const text = (segs: { text: string; mark: boolean }[], marked = false) =>
  segs
    .filter((s) => !marked || s.mark)
    .map((s) => s.text)
    .join("");

describe("runbook diff rows", () => {
  test("numbers lines on each side and keeps unchanged lines", () => {
    const rows = diffRows("# Title\n\nInstall the 0.9 beta.", "# Title\n\nInstall v1.0.");
    expect(rows.map((r) => r.op)).toEqual([" ", " ", "-", "+"]);
    expect(rows[2]!.oldNo).toBe(3);
    expect(rows[3]!.newNo).toBe(3);
  });

  test("marks whole changed words inside a changed line pair", () => {
    const [del, add] = diffRows("Install the 0.9 beta.", "Install v1.0.");
    expect(text(del!.segs)).toBe("Install the 0.9 beta.");
    expect(text(del!.segs, true)).toBe("the 0.9 beta.");
    expect(text(add!.segs, true)).toBe("v1.0.");
  });

  test("does not mark words when the lines share almost nothing", () => {
    const [del, add] = diffRows("> The beta API may change", "## What changed in v1.0");
    expect(del!.segs.some((s) => s.mark)).toBe(false);
    expect(add!.segs.some((s) => s.mark)).toBe(false);
  });

  test("pure additions and removals", () => {
    expect(diffRows("a", "a\nb").map((r) => r.op)).toEqual([" ", "+"]);
    expect(diffRows("a\nb", "a").map((r) => r.op)).toEqual([" ", "-"]);
  });
});

describe("output words", () => {
  test("human keys", () => {
    expect(humanKey("published_at")).toBe("Published at");
    expect(humanKey("postsAt")).toBe("Posts at");
  });

  test("summarize names the list by its key and count", () => {
    expect(summarize({ releases: [{ version: "v0.9.0", published_at: "2026-10-01T12:00:00.000Z" }] })).toBe("1 release · latest v0.9.0");
    expect(summarize({ items: [] })).toBe("0 items");
  });
});
