import { describe, expect, test } from "bun:test";
import { changedKeys, humanKey, plainText, showValue, toLines } from "../providers/sheet-format";

describe("approval sheet values", () => {
  test("booleans read as Yes and No", () => {
    expect(showValue(false)).toEqual({ kind: "bool", value: false, text: "No" });
    expect(showValue(true)).toMatchObject({ text: "Yes" });
  });

  test("empty values say so", () => {
    expect(showValue("")).toMatchObject({ kind: "empty", text: "Not set" });
    expect(showValue(undefined)).toMatchObject({ kind: "empty" });
    expect(showValue([])).toMatchObject({ kind: "empty", text: "None" });
  });

  test("ISO dates become local dates with a relative time", () => {
    const now = Date.parse("2026-11-19T10:00:00Z");
    const shown = showValue("2026-11-19T12:00:00.000Z", now, "en-US");
    expect(shown.kind).toBe("date");
    if (shown.kind !== "date") return;
    expect(shown.relative).toBe("in 2 hours");
    expect(shown.text).toContain("2026");
    expect(shown.iso).toBe("2026-11-19T12:00:00.000Z");
  });

  test("version strings are not mistaken for dates", () => {
    expect(showValue("v1.0")).toMatchObject({ kind: "text", text: "v1.0", long: false });
  });

  test("Markdown-ish text becomes heading, item and paragraph lines", () => {
    expect(toLines("## v1.0\n\n- First public release\n- New plugin API")).toEqual([
      { kind: "heading", text: "v1.0" },
      { kind: "item", text: "First public release" },
      { kind: "item", text: "New plugin API" },
    ]);
    expect(showValue("Mosaic v1.0 is here!\n\nFirst")).toMatchObject({ kind: "lines", long: false });
  });

  test("long text folds", () => {
    expect(showValue("x".repeat(400))).toMatchObject({ kind: "text", long: true });
    expect(showValue(Array.from({ length: 9 }, (_, i) => `- item ${i}`).join("\n"))).toMatchObject({ kind: "lines", long: true });
  });

  test("lists and objects", () => {
    expect(showValue(["a", "b"])).toEqual({ kind: "list", items: ["a", "b"] });
    expect(showValue({ a: 1 }).kind).toBe("json");
    expect(showValue(1234.5, Date.now(), "en-US")).toEqual({ kind: "number", text: "1,234.5" });
  });

  test("field keys without a title read as words", () => {
    expect(humanKey("post_at")).toBe("Post at");
    expect(humanKey("releaseNotes")).toBe("Release notes");
  });

  test("changed keys and plain text for the word diff", () => {
    expect(changedKeys({ a: 1, b: "x" }, { a: 1, b: "y", c: true })).toEqual(["b", "c"]);
    expect(changedKeys({ a: 1, gone: 2 }, { a: 1 })).toEqual(["gone"]);
    expect(plainText(false)).toBe("No");
    expect(plainText(undefined)).toBe("");
  });
});
