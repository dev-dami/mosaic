// Area B "entry" owns this file. It is the hook through which the outcome sentence picks and
// orders the runbook's steps. The shared model (state/model.ts) calls planWorkspace with a fixed
// signature. Pure and deterministic: keyword and name matching over what sites publish, no model,
// no network. Ported from src/workspace.ts on design/outcome-workspace and reshaped for CapRefs.
//
// How a plan is made:
//   1. The outcome is cut into terms (lower case, stemmed, stopwords and version numbers dropped).
//   2. Each term also brings a few related words ("launch" brings release, changelog, docs,
//      announcement). The list is generic release-work vocabulary, not tied to any site.
//   3. A capability is picked when a term matches a word of its title or id. If no title matches
//      at all, the plain terms are matched against descriptions instead.
//   4. Anything a picked capability reads from (the same automatic bindings the document uses) is
//      picked too, until nothing changes. Context reads (no input) follow their site.
//   5. Nothing matched, or no outcome: every capability stays in. Mosaic never hides everything.
//   6. A site the outcome picks nothing on keeps all its steps. The person connected it, so the
//      plan narrows inside the sites the outcome names and never drops a whole site.
//   7. Sites are ordered by where the outcome mentions them, but a site that reads another site's
//      output always comes after it. Sites with nothing picked go last.
import { autoBinding, parseOutcome, type CapKey, type CapRef } from "../doc";

export type PlanInput = {
  /** The outcome sentence as typed. */
  outcome: string;
  /** Every capability of every connected site, in connection order. */
  refs: CapRef[];
  /** Origins in data-dependency order (a site that reads another's output comes after it). */
  siteOrder: string[];
};

export type Plan = {
  /** Origins in the order their steps appear. Must contain each origin of `siteOrder` exactly once. */
  siteOrder: string[];
  /** Capabilities the outcome does not need, only ever on sites it picked something on. */
  hidden: Set<CapKey>;
};

const STOPWORDS = new Set(
  "a an and are as at be by for from i in into is it its me my of on or our please the then this to up we with you your want need get make do all done can let lets".split(" "),
);

/** Outcome word → words it also brings into the match. One way: the outcome side expands. */
const RELATED: [string[], string[]][] = [
  [["launch", "ship", "golive", "rollout"], ["release", "publish", "changelog", "note", "announce", "announcement", "post", "doc", "documentation"]],
  [["release"], ["publish", "changelog", "note"]],
  [["announce", "announcement", "tell", "share", "promote", "broadcast"], ["announce", "announcement", "post", "schedule"]],
  [["doc", "documentation", "document", "guide", "manual", "readme"], ["doc", "documentation"]],
  [["changelog", "note", "highlight"], ["changelog", "note", "highlight"]],
  [["post", "tweet", "newsletter", "blog"], ["post", "announcement", "announce"]],
];

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The meaningful words of a text: lower case, stemmed, no stopwords, no numbers or versions. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^v?\d/.test(raw)) continue;
    const s = stem(raw);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Equal stems, or one a prefix of the other when the shorter has 3+ letters (doc ~ documentation). */
export function sameTerm(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

const expand = (term: string): string[] => [term, ...RELATED.filter(([from]) => from.some((f) => sameTerm(f, term))).flatMap(([, to]) => to)];

const hasInputs = (r: CapRef) => Object.keys(r.cap.input_schema.properties ?? {}).length > 0;

/** Why a capability is in the plan. */
export type PickReason =
  /** An outcome word matched its title or id (`words` are the outcome words, as typed in terms). */
  | { kind: "matched"; words: string[] }
  /** Its description matched (used only when no title matched anywhere). */
  | { kind: "described"; words: string[] }
  /** A picked capability reads one of its outputs, or it mirrors one. */
  | { kind: "feeds"; into: CapKey }
  /** A read with no input that runs as context for its site. */
  | { kind: "context" };

export type PlanAnalysis = {
  /** The outcome's terms, in order. */
  terms: string[];
  /** "all": nothing to plan from (no outcome, or nothing matched); every capability stays in. */
  mode: "matched" | "all";
  picked: Map<CapKey, PickReason>;
  /** Index in `terms` of the first word that picked something on each origin. */
  firstMention: Map<string, number>;
};

/** Which capabilities the outcome picks, and why. Pure. */
export function analyzeOutcome(outcome: string, refs: CapRef[]): PlanAnalysis {
  const t = terms(outcome);
  const picked = new Map<CapKey, PickReason>();
  const firstMention = new Map<string, number>();
  const note = (r: CapRef, words: string[]) => {
    const at = Math.min(...words.map((w) => t.indexOf(w)));
    const prev = firstMention.get(r.origin);
    if (prev === undefined || at < prev) firstMention.set(r.origin, at);
  };

  // 3. Titles and ids, with related words.
  for (const r of refs) {
    const own = terms(`${r.cap.title} ${r.cap.id.replace(/[-_]/g, " ")}`);
    const words = t.filter((w) => expand(w).some((x) => own.some((o) => sameTerm(x, o))));
    if (words.length) {
      picked.set(r.key, { kind: "matched", words });
      note(r, words);
    }
  }
  // ...or descriptions, plain words only, when no title matched anywhere.
  if (picked.size === 0) {
    for (const r of refs) {
      const own = terms(r.cap.description);
      const words = t.filter((w) => own.some((o) => sameTerm(w, o)));
      if (words.length) {
        picked.set(r.key, { kind: "described", words });
        note(r, words);
      }
    }
  }
  if (picked.size === 0) return { terms: t, mode: "all", picked, firstMention };

  // 4. Pull in what picked capabilities read from, until stable.
  const parsed = parseOutcome(outcome);
  const docProps: Record<string, string> = { project: parsed.project ?? "", version: parsed.version ?? "" };
  const byKey = new Map(refs.map((r) => [r.key, r]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...picked.keys()]) {
      const r = byKey.get(key)!;
      for (const field of Object.keys(r.cap.input_schema.properties ?? {})) {
        const b = autoBinding(r, field, refs, docProps);
        if (!b || b.kind === "prop" || picked.has(b.cap)) continue;
        picked.set(b.cap, { kind: "feeds", into: key });
        const src = byKey.get(b.cap);
        if (src && !firstMention.has(src.origin)) firstMention.set(src.origin, firstMention.get(r.origin) ?? t.length);
        changed = true;
      }
    }
  }
  // Context reads follow their site.
  const live = new Set([...picked.keys()].map((k) => byKey.get(k)!.origin));
  for (const r of refs) if (!picked.has(r.key) && r.cap.side_effects === "read" && !hasInputs(r) && live.has(r.origin)) picked.set(r.key, { kind: "context" });

  return { terms: t, mode: "matched", picked, firstMention };
}

/** Site A must come before site B when a visible read on B takes an output of a capability on A. */
function siteDeps(refs: CapRef[], visible: (r: CapRef) => boolean, outcome: string): Map<string, Set<string>> {
  const parsed = parseOutcome(outcome);
  const docProps: Record<string, string> = { project: parsed.project ?? "", version: parsed.version ?? "" };
  const byKey = new Map(refs.map((r) => [r.key, r]));
  const deps = new Map<string, Set<string>>();
  for (const r of refs) {
    if (r.cap.side_effects !== "read" || !visible(r)) continue;
    for (const field of Object.keys(r.cap.input_schema.properties ?? {})) {
      const b = autoBinding(r, field, refs, docProps);
      if (b?.kind !== "output") continue;
      const from = byKey.get(b.cap)?.origin;
      if (from && from !== r.origin) (deps.get(r.origin) ?? deps.set(r.origin, new Set()).get(r.origin)!).add(from);
    }
  }
  return deps;
}

export function planWorkspace(input: PlanInput): Plan {
  const { outcome, refs, siteOrder } = input;
  const a = analyzeOutcome(outcome, refs);
  if (a.mode === "all") return { siteOrder, hidden: new Set() };

  const named = new Set(refs.filter((r) => a.picked.has(r.key)).map((r) => r.origin));
  const hidden = new Set(refs.filter((r) => named.has(r.origin) && !a.picked.has(r.key)).map((r) => r.key));
  const deps = siteDeps(refs, (r) => !hidden.has(r.key), outcome);
  const given = new Map(siteOrder.map((o, i) => [o, i]));
  const rank = (o: string) => [a.firstMention.get(o) ?? Number.POSITIVE_INFINITY, given.get(o) ?? 0] as const;
  const before = (x: string, y: string) => {
    const [mx, gx] = rank(x);
    const [my, gy] = rank(y);
    return mx !== my ? mx < my : gx < gy;
  };

  // Kahn's algorithm, always taking the best-ranked site whose sources are placed.
  const out: string[] = [];
  const left = [...siteOrder];
  while (left.length) {
    const ready = left.filter((o) => [...(deps.get(o) ?? [])].every((d) => out.includes(d) || !left.includes(d)));
    const pool = ready.length ? ready : left; // a cycle cannot happen with reads only, but never stall
    const next = pool.reduce((best, o) => (before(o, best) ? o : best));
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return { siteOrder: out, hidden };
}
