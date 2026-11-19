// The document model derived from state: which capabilities are placed, in which step order,
// where each input takes its value from, and what is still waiting for approval.
// Owner: foundation (shared). Pure: the same state gives the same model.
import { compileForm, FormError, initialValues, toInput, type FormValues } from "../../form";
import { autoBinding, capKey, orderSites, outputFields, parseOutcome, resolve, type Binding, type CapKey, type CapRef, type Lookup } from "../doc";
import { planWorkspace } from "../entry/plan";
import type { TokenInfo } from "../primitives/provenance";
import type { Conn, State } from "./types";

export const hasInputs = (r: CapRef) => Object.keys(r.cap.input_schema.properties ?? {}).length > 0;
export const inputKeys = (r: CapRef) => Object.keys(r.cap.input_schema.properties ?? {});

export type Model = {
  /** Every capability of every connected site, in connection order. */
  refs: CapRef[];
  refMap: Map<CapKey, CapRef>;
  /** Project and Version: typed overrides first, then values parsed from the outcome sentence. */
  docProps: Record<string, string>;
  /** Origins in step order: a site that reads another site's output comes after it. */
  siteOrder: string[];
  /** Step number (1-based) by origin. */
  stepOf: Map<string, number>;
  /** Capabilities the outcome plan leaves out (see entry/plan.ts). */
  hidden: Set<CapKey>;
  connFor: (origin: string) => Conn | undefined;
  /** Every write, in step order. */
  writes: CapRef[];
  /** Writes not yet approved and done. */
  pendingWrites: CapRef[];
  /** Reads that take input (context reads with no input run on their own). */
  reads: CapRef[];
  doneCount: number;
  totalCount: number;
  /** The connection whose own approval sheet is showing. */
  waitingOn: Conn | undefined;
  bindingFor: (key: CapKey, field: string) => Binding | null;
  lookup: Lookup;
  tokenInfo: (b: Binding) => TokenInfo;
  /** Capabilities whose inputs read an output of `key`. */
  usedBy: (key: CapKey) => CapRef[];
  /** Is `field` of `key`'s output read by any other capability? */
  isOutputUsed: (key: CapKey, field: string) => boolean;
  /** The typed input for a run. Throws FormError when a value is missing or comes from a step that has not run. */
  inputFor: (r: CapRef) => unknown;
  readyOf: (origin: string) => boolean;
};

export function deriveModel(state: State): Model {
  const { conns, runs, manual, bindings } = state;
  const refs: CapRef[] = conns.flatMap((c, ci) =>
    c.site.capabilities.map((cap, i) => ({ key: capKey(c.site.site.origin, cap.id), origin: c.site.site.origin, siteName: c.site.site.name, cap, order: ci * 100 + i })),
  );
  const refMap = new Map(refs.map((r) => [r.key, r]));
  const parsed = parseOutcome(state.title);
  const docProps: Record<string, string> = { project: state.overrides.project ?? parsed.project ?? "", version: state.overrides.version ?? parsed.version ?? "" };

  const bindingFor = (key: CapKey, field: string): Binding | null => {
    const explicit = bindings[key];
    if (explicit && field in explicit) return explicit[field] ?? null;
    const r = refMap.get(key);
    return r ? autoBinding(r, field, refs, docProps) : null;
  };
  const lookup: Lookup = {
    binding: bindingFor,
    manual: (k, f) => manual[k]?.[f],
    output: (k) => {
      const run = runs[k];
      return run?.status === "done" ? run.output : undefined;
    },
    docProps,
  };

  const connFor = (origin: string) => conns.find((c) => c.site.site.origin === origin);
  const defaultOrder = orderSites(
    conns.map((c) => c.site.site.origin),
    (o) => {
      const deps = new Set<string>();
      for (const r of refs) {
        if (r.origin !== o || r.cap.side_effects !== "read") continue;
        for (const f of inputKeys(r)) {
          const b = bindingFor(r.key, f);
          if (b?.kind === "output") deps.add(refMap.get(b.cap)?.origin ?? o);
        }
      }
      return deps;
    },
  );
  const plan = planWorkspace({ outcome: state.title, refs, siteOrder: defaultOrder });
  const siteOrder = plan.siteOrder;
  const hidden = plan.hidden;
  const stepOf = new Map(siteOrder.map((o, i) => [o, i + 1]));
  const writes = siteOrder.flatMap((o) => refs.filter((r) => r.origin === o && r.cap.side_effects === "write" && !hidden.has(r.key)));
  const reads = refs.filter((r) => r.cap.side_effects === "read" && hasInputs(r) && !hidden.has(r.key));
  const doneCount = [...writes, ...reads].filter((r) => runs[r.key]?.status === "done").length;
  const pendingWrites = writes.filter((w) => runs[w.key]?.status !== "done");

  const tokenInfo = (b: Binding): TokenInfo => {
    if (b.kind === "prop") return { source: "Outcome", label: b.key[0]!.toUpperCase() + b.key.slice(1) };
    const src = refMap.get(b.cap);
    if (!src) return { source: "Missing", label: b.field };
    if (b.kind === "mirror") return { source: src.cap.title, label: "same as preview", origin: src.origin, siteName: src.siteName };
    return { source: `${stepOf.get(src.origin) ?? "?"} · ${src.siteName}`, label: b.field, origin: src.origin, siteName: src.siteName };
  };

  const readsFrom = (o: CapRef, key: CapKey, field?: string) =>
    inputKeys(o).some((f) => {
      const b = bindingFor(o.key, f);
      return b?.kind === "output" && b.cap === key && (field === undefined || b.field === field);
    });
  const usedBy = (key: CapKey) => refs.filter((o) => o.key !== key && readsFrom(o, key));
  const isOutputUsed = (key: CapKey, field: string) => refs.some((o) => o.key !== key && readsFrom(o, key, field));

  const inputFor = (r: CapRef): unknown => {
    const fields = compileForm(r.cap.input_schema);
    const values: FormValues = { ...initialValues(fields), ...manual[r.key] };
    for (const f of fields) {
      const res = resolve(bindingFor(r.key, f.key), lookup);
      if (res.state === "value") values[f.key] = res.value;
      if (res.state === "pending") {
        const src = refMap.get(res.from);
        throw new FormError(`${f.label} comes from “${src?.cap.title}” on ${src?.siteName}. Run that step first.`);
      }
    }
    return toInput(fields, values);
  };

  return {
    refs,
    refMap,
    docProps,
    siteOrder,
    stepOf,
    hidden,
    connFor,
    writes,
    pendingWrites,
    reads,
    doneCount,
    totalCount: writes.length + reads.length,
    waitingOn: state.confirming ? connFor(state.confirming) : undefined,
    bindingFor,
    lookup,
    tokenInfo,
    usedBy,
    isOutputUsed,
    inputFor,
    readyOf: (origin) => connFor(origin)?.status === "ready",
  };
}

/** Output fields of other reads that an empty text field could take (offered as one-click links). */
export function suggestionsFor(model: Model, r: CapRef): Binding[] {
  return model.refs
    .filter((o) => o.key !== r.key && o.cap.side_effects === "read")
    .flatMap((o) => outputFields(o.cap).map((f) => ({ kind: "output", cap: o.key, field: f }) as Binding))
    .filter((b) => b.kind === "output" && !["before", "path"].includes(b.field))
    .slice(0, 3);
}
