import type { JsonSchema } from "./protocol";

export type Field =
  | { kind: "text" | "textarea"; key: string; label: string; required: boolean; help?: string; initial: string }
  | { kind: "number" | "integer"; key: string; label: string; required: boolean; help?: string; initial: string }
  | { kind: "boolean"; key: string; label: string; required: boolean; help?: string; initial: boolean }
  | { kind: "select"; key: string; label: string; required: boolean; help?: string; initial: string; options: string[] }
  | { kind: "list"; key: string; label: string; required: boolean; help?: string; initial: string }
  | { kind: "json"; key: string; label: string; required: boolean; help?: string; initial: string };

export type FormValues = Record<string, string | boolean>;

export class FormError extends Error {}

function fieldFor(key: string, schema: JsonSchema, required: boolean): Field {
  const base = { key, label: schema.title ?? key, required, help: schema.description };
  if (schema.enum && schema.enum.every((v) => typeof v === "string")) {
    const options = schema.enum as string[];
    return { ...base, kind: "select", options, initial: String(schema.default ?? options[0] ?? "") };
  }
  switch (schema.type) {
    case "string": {
      const long = schema["x-mosaic-widget"] === "textarea" || (schema.maxLength ?? 0) > 200;
      return { ...base, kind: long ? "textarea" : "text", initial: String(schema.default ?? "") };
    }
    case "number":
    case "integer":
      return { ...base, kind: schema.type, initial: schema.default === undefined ? "" : String(schema.default) };
    case "boolean":
      return { ...base, kind: "boolean", initial: schema.default === true };
    case "array":
      if (schema.items?.type === "string") {
        const initial = Array.isArray(schema.default) ? schema.default.join("\n") : "";
        return { ...base, kind: "list", initial };
      }
  }
  return { ...base, kind: "json", initial: schema.default === undefined ? "" : JSON.stringify(schema.default, null, 2) };
}

/** Compile an object input schema into form fields. Schemas the compiler does not know fall back to raw JSON. */
export function compileForm(schema: JsonSchema): Field[] {
  if (schema.type !== "object" || !schema.properties) {
    return [{ kind: "json", key: "", label: "Input (JSON)", required: true, initial: "{}" }];
  }
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([key, prop]) => fieldFor(key, prop, required.has(key)));
}

export function initialValues(fields: Field[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.initial]));
}

/** Turn form values into the JSON value the capability receives. The site validates it again. */
export function toInput(fields: Field[], values: FormValues): unknown {
  const root = fields.length === 1 && fields[0]?.key === "";
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? field.initial;
    if (field.kind === "boolean") {
      out[field.key] = raw === true;
      continue;
    }
    const text = String(raw).trim();
    if (text === "") {
      if (field.required) throw new FormError(`${field.label} is required`);
      continue;
    }
    switch (field.kind) {
      case "number":
      case "integer": {
        const n = Number(text);
        if (!Number.isFinite(n) || (field.kind === "integer" && !Number.isInteger(n))) {
          throw new FormError(`${field.label} must be ${field.kind === "integer" ? "a whole number" : "a number"}`);
        }
        out[field.key] = n;
        break;
      }
      case "list":
        out[field.key] = text.split("\n").map((s) => s.trim()).filter(Boolean);
        break;
      case "json":
        try {
          out[field.key] = JSON.parse(text);
        } catch {
          throw new FormError(`${field.label} is not valid JSON`);
        }
        break;
      case "text":
      case "textarea":
      case "select":
        out[field.key] = text;
        break;
    }
  }
  return root ? out[""] : out;
}
