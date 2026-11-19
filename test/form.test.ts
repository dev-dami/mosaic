import { describe, expect, test } from "bun:test";
import { compileForm, FormError, initialValues, toInput } from "../src/form";

const schema = {
  type: "object",
  required: ["version", "highlights"],
  properties: {
    version: { type: "string", title: "Version", default: "v1.0" },
    notes: { type: "string", "x-mosaic-widget": "textarea" as const },
    highlights: { type: "array", items: { type: "string" } },
    tone: { type: "string", enum: ["plain", "excited"] },
    delay: { type: "integer" },
    draft: { type: "boolean", default: true },
    meta: { type: "object" },
    at: { type: "string", format: "date-time" },
  },
};

describe("compileForm", () => {
  test("maps each schema type to a widget", () => {
    const kinds = Object.fromEntries(compileForm(schema).map((f) => [f.key, f.kind]));
    expect(kinds).toEqual({ version: "text", notes: "textarea", highlights: "list", tone: "select", delay: "integer", draft: "boolean", meta: "json", at: "datetime" });
  });

  test("falls back to one raw JSON field for a non-object schema", () => {
    expect(compileForm({ type: "string" })).toEqual([{ kind: "json", key: "", label: "Input (JSON)", required: true, initial: "{}" }]);
  });
});

describe("toInput", () => {
  const fields = compileForm(schema);

  test("builds typed input from form values", () => {
    const values = { ...initialValues(fields), highlights: "Fast\n\n Stable ", delay: "5", meta: '{"a":1}' };
    expect(toInput(fields, values)).toEqual({ version: "v1.0", highlights: ["Fast", "Stable"], tone: "plain", delay: 5, draft: true, meta: { a: 1 } });
  });

  test("refuses a missing required value", () => {
    expect(() => toInput(fields, { ...initialValues(fields), version: " " })).toThrow(FormError);
  });

  test("turns a local date-time into an ISO timestamp", () => {
    const values = { ...initialValues(fields), highlights: "x", at: "2026-11-20T09:30" };
    expect((toInput(fields, values) as { at: string }).at).toBe(new Date("2026-11-20T09:30").toISOString());
    expect(() => toInput(fields, { ...values, at: "soon" })).toThrow("valid date");
  });

  test("refuses a fraction for an integer", () => {
    expect(() => toInput(fields, { ...initialValues(fields), highlights: "x", delay: "1.5" })).toThrow("whole number");
  });
});
