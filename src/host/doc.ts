// Pure logic behind the runbook document: provenance marks, markdown and diff rendering
// models, the outcome sentence, and how one block's output feeds another block's input.
// Nothing here knows about a particular site: it reads only manifests and run results.
import type { Capability, JsonSchema } from "../protocol";

export type CapKey = string;
export const capKey = (origin: string, id: string): CapKey => `${origin}#${id}`;

/** A capability placed in the document, in connection order. */
export type CapRef = { key: CapKey; origin: string; siteName: string; cap: Capability; order: number };

// ── Provenance ────────────────────────────────────────────────────────────────

/** Hue from the origin, computed by the host. A site cannot pick it, so it cannot copy another site's mark. */
export function hueOf(origin: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < origin.length; i++) {
    h ^= origin.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) % 360;
}

export function monogram(name: string): string {
  const word = name.split(/\s+/).find((w) => /[a-z0-9]/i.test(w) && !/^(the|demo)$/i.test(w)) ?? name;
  return (word.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
}

/** Split an origin for display: the registrable part at full contrast, the rest muted. */
export function originParts(origin: string): { lead: string; main: string; tail: string } {
  const url = new URL(origin);
  const labels = url.hostname.split(".");
  const main = labels.length > 2 ? labels.slice(-2).join(".") : url.hostname;
  const lead = labels.length > 2 ? labels.slice(0, -2).join(".") + "." : "";
  return { lead, main, tail: url.port ? `:${url.port}` : "" };
}

export const hostOf = (origin: string) => new URL(origin).host;

/** The DOM id of a capability's block, for in-page links (`#cap-…`). */
export const capAnchor = (key: CapKey) => `cap-${key.replace(/[^a-z0-9]+/gi, "-")}`;

// ── Outcome sentence ──────────────────────────────────────────────────────────

const VERBS = /^(launch|ship|release|publish|announce|cut|prepare|update|apply|draft|write|schedule|post)\b/i;
/** Words that name the work, not the project ("Update the docs for v2.1" has no project). */
const TASK_NOUNS = /\b(docs?|documentation|changelogs?|notes|releases?|announcements?|posts?|updates?)\b/gi;

/** "Launch Lumen v1.0" → { project: "Lumen", version: "v1.0" }. Deterministic, no model. */
export function parseOutcome(title: string): { project?: string; version?: string } {
  const versionMatch = title.match(/\bv?\d+(?:\.\d+){0,2}(?:-[\w.]+)?\b/);
  const version = versionMatch ? (versionMatch[0].startsWith("v") ? versionMatch[0] : `v${versionMatch[0]}`) : undefined;
  let rest = versionMatch ? title.replace(versionMatch[0], " ") : title;
  rest = rest.replace(VERBS, " ").replace(TASK_NOUNS, " ").replace(/\b(of|for|the|a|an|and|then|to)\b/gi, " ").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
  return { project: rest || undefined, version };
}

// ── Markdown (a small, safe subset rendered to elements, never to HTML strings) ──

export type MdBlock =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "code"; text: string };

export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i]!);
      out.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      flush();
      out.push({ t: "h", level: heading[1]!.length, text: heading[2]! });
    } else if (item) {
      flush();
      const last = out[out.length - 1];
      if (last?.t === "ul") last.items.push(item[1]!);
      else out.push({ t: "ul", items: [item[1]!] });
    } else if (line.trim() === "") {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

export type Inline = { t: "text" | "code" | "strong" | "em"; text: string };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", text: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) out.push({ t: "code", text: tok.slice(1, -1) });
    else if (tok.startsWith("**")) out.push({ t: "strong", text: tok.slice(2, -2) });
    else out.push({ t: "em", text: tok.slice(1, -1) });
    last = m.index! + tok.length;
  }
  if (last < s.length) out.push({ t: "text", text: s.slice(last) });
  return out;
}

/** Does this string read as markdown (or multi-line text) rather than a short value? */
export const looksLikeMarkdown = (s: string) => s.includes("\n") || /^#{1,4}\s|^\s*[-*]\s/m.test(s);

// ── Line diff (LCS) ───────────────────────────────────────────────────────────

export type DiffLine = { op: " " | "+" | "-"; text: string };

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: " ", text: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ op: "-", text: x[i++]! });
    else out.push({ op: "+", text: y[j++]! });
  }
  while (i < n) out.push({ op: "-", text: x[i++]! });
  while (j < m) out.push({ op: "+", text: y[j++]! });
  return out;
}

// ── Data flow between blocks ──────────────────────────────────────────────────

/**
 * Where a field's value comes from:
 * - `prop`: a property of the document (Project, Version), matched by field name.
 * - `output`: a field of another block's output.
 * - `mirror`: the same field of a read on the same site, so a write publishes what was previewed.
 */
export type Binding =
  | { kind: "prop"; key: string }
  | { kind: "output"; cap: CapKey; field: string }
  | { kind: "mirror"; cap: CapKey; field: string };

export const sameBinding = (a: Binding | null, b: Binding | null) => JSON.stringify(a) === JSON.stringify(b);

const props = (schema: JsonSchema) => schema.properties ?? {};
const isTextish = (s: JsonSchema | undefined) => !!s && (s.type === undefined || s.type === "string") && !s.enum;
const bindable = (s: JsonSchema | undefined) => !!s && (s.type === undefined || s.type === "string" || (s.type === "array" && s.items?.type === "string")) && !s.enum;

/** String output fields a block offers to the rest of the document. */
export function outputFields(cap: Capability): string[] {
  return Object.entries(props(cap.output_schema))
    .filter(([, s]) => isTextish(s))
    .map(([k]) => k);
}

/** The binding Mosaic proposes when the person has not chosen one. Pure name matching, no site knowledge. */
export function autoBinding(target: CapRef, field: string, all: CapRef[], docProps: Record<string, string>): Binding | null {
  const schema = props(target.cap.input_schema)[field];
  if (!bindable(schema)) return null;
  const propKey = Object.keys(docProps).find((k) => k.toLowerCase() === field.toLowerCase());
  if (propKey && docProps[propKey]) return { kind: "prop", key: propKey };
  const reads = all.filter((r) => r.key !== target.key && r.cap.side_effects === "read");
  if (target.cap.side_effects === "write") {
    const twin = reads.find((r) => r.origin === target.origin && field in props(r.cap.input_schema));
    if (twin) return { kind: "mirror", cap: twin.key, field };
  }
  const byName = (name: string) =>
    reads
      .filter((r) => outputFields(r.cap).includes(name))
      .sort((a, b) => Number(b.origin === target.origin) - Number(a.origin === target.origin) || a.order - b.order)[0];
  const producer = byName(field);
  if (producer) return { kind: "output", cap: producer.key, field };
  // No output has the field's own name: try the few generic words for "what changed", in order.
  for (const alias of aliasesOf(field)) {
    const p = byName(alias);
    if (p) return { kind: "output", cap: p.key, field: alias };
  }
  return null;
}

/**
 * Field names that mean the same thing across sites, most specific first. Generic vocabulary, not
 * tied to any site; used only when no output has the exact name. Kept small on purpose: a wrong
 * automatic binding costs more than one click on a suggestion.
 */
const ALIASES: string[][] = [["summary", "changes", "notes", "release_notes", "changelog"]];

function aliasesOf(field: string): string[] {
  const f = field.toLowerCase();
  const group = ALIASES.find((g) => g.includes(f));
  return group ? group.filter((x) => x !== f) : [];
}

export type Resolved =
  | { state: "value"; value: string }
  | { state: "pending"; from: CapKey }
  | { state: "none" };

export type Lookup = {
  binding: (cap: CapKey, field: string) => Binding | null;
  manual: (cap: CapKey, field: string) => string | boolean | undefined;
  output: (cap: CapKey) => unknown | undefined;
  docProps: Record<string, string>;
};

export function resolve(binding: Binding | null, lookup: Lookup, depth = 0): Resolved {
  if (!binding || depth > 6) return { state: "none" };
  switch (binding.kind) {
    case "prop": {
      const v = lookup.docProps[binding.key];
      return v ? { state: "value", value: v } : { state: "none" };
    }
    case "output": {
      const out = lookup.output(binding.cap);
      if (out === undefined) return { state: "pending", from: binding.cap };
      const v = (out as Record<string, unknown> | null)?.[binding.field];
      return v === undefined || v === null ? { state: "none" } : { state: "value", value: String(v) };
    }
    case "mirror": {
      const inner = lookup.binding(binding.cap, binding.field);
      if (inner) return resolve(inner, lookup, depth + 1);
      const v = lookup.manual(binding.cap, binding.field);
      return typeof v === "string" && v.trim() ? { state: "value", value: v } : { state: "none" };
    }
  }
}

/** Order sites so a site whose blocks read another site's output comes after it. Stable otherwise. */
export function orderSites(origins: string[], dependsOn: (origin: string) => Set<string>): string[] {
  const placed: string[] = [];
  const left = [...origins];
  while (left.length) {
    const idx = left.findIndex((o) => [...dependsOn(o)].every((d) => d === o || placed.includes(d) || !left.includes(d)));
    placed.push(...left.splice(idx === -1 ? 0 : idx, 1));
  }
  return placed;
}

/** Short one-line preview of a value for chips and line items. */
export function preview(value: string, max = 64): string {
  const flat = value.replace(/^#{1,4}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "· ").replace(/\s*\n+\s*/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
