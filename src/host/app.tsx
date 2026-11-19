import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { compileForm, FormError, initialValues, toInput, type Field, type FormValues } from "../form";
import { discoverSite, MANIFEST_PATH, type Site } from "../protocol";
import { BridgeCallError, BridgeClient } from "./bridge-client";
import {
  autoBinding,
  capKey,
  hostOf,
  hueOf,
  orderSites,
  outputFields,
  parseOutcome,
  preview,
  resolve,
  sameBinding,
  type Binding,
  type CapKey,
  type CapRef,
  type Lookup,
} from "./doc";
import { Control, fmtTime, hueStyle, Markdown, Monogram, Origin, OutputView, Provenance, schemaType, Token, type TokenInfo } from "./ui";

type Conn = { key: number; site: Site; status: "connecting" | "ready" | "failed"; failure?: string };
type Run =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; output: unknown; at: Date }
  | { status: "error"; message: string; denied: boolean; at: Date };
type Receipt = { id: number; at: Date; origin: string; siteName: string; title: string; write: boolean; outcome: "done" | "denied" | "failed"; detail: string };
type TraceStep = { label: string; state: "doing" | "done" | "failed" };
type Trace = { origin: string; steps: TraceStep[] };
type HostInfo = { build: string; suggestions: string[] };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pace = (ms = 260) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));
const hasInputs = (r: CapRef) => Object.keys(r.cap.input_schema.properties ?? {}).length > 0;
const SHEET_LINGER_MS = 750;
const domId = (key: string) => key.replace(/[^a-z0-9]+/gi, "-");

function App() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [buildCheck, setBuildCheck] = useState<"same" | "changed" | null>(null);
  const [title, setTitle] = useState("Launch Lumen v1.0");
  const [overrides, setOverrides] = useState<{ project?: string; version?: string }>({});
  const [runs, setRuns] = useState<Record<CapKey, Run>>({});
  const [manual, setManual] = useState<Record<CapKey, FormValues>>({});
  const [bindings, setBindings] = useState<Record<CapKey, Record<string, Binding | null>>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [hot, setHot] = useState<CapKey | null>(null);
  const [pulse, setPulse] = useState<{ cap: CapKey; at: number } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const clients = useRef(new Map<string, BridgeClient>());
  const nextKey = useRef(1);
  const receiptId = useRef(1);
  const firstBuild = useRef<string | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/mosaic-host.json")
      .then((r) => r.json())
      .then(
        (info: HostInfo) => {
          firstBuild.current = info.build;
          setHost(info);
        },
        () => setHost({ build: "unknown", suggestions: [] }),
      );
  }, []);

  // ── Derived document model ────────────────────────────────────────────────
  const refs: CapRef[] = useMemo(
    () =>
      conns.flatMap((c, ci) =>
        c.site.capabilities.map((cap, i) => ({ key: capKey(c.site.site.origin, cap.id), origin: c.site.site.origin, siteName: c.site.site.name, cap, order: ci * 100 + i })),
      ),
    [conns],
  );
  const refMap = useMemo(() => new Map(refs.map((r) => [r.key, r])), [refs]);
  const parsed = parseOutcome(title);
  const docProps: Record<string, string> = { project: overrides.project ?? parsed.project ?? "", version: overrides.version ?? parsed.version ?? "" };

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

  const origins = conns.map((c) => c.site.site.origin);
  const siteOrder = orderSites(origins, (o) => {
    const deps = new Set<string>();
    for (const r of refs) {
      if (r.origin !== o || r.cap.side_effects !== "read") continue;
      for (const f of Object.keys(r.cap.input_schema.properties ?? {})) {
        const b = bindingFor(r.key, f);
        if (b?.kind === "output") deps.add(refMap.get(b.cap)?.origin ?? o);
      }
    }
    return deps;
  });
  const connFor = (origin: string) => conns.find((c) => c.site.site.origin === origin)!;
  const stepOf = new Map(siteOrder.map((o, i) => [o, i + 1]));
  const writes = siteOrder.flatMap((o) => refs.filter((r) => r.origin === o && r.cap.side_effects === "write"));
  const reads = refs.filter((r) => r.cap.side_effects === "read" && hasInputs(r));
  const doneCount = refs.filter((r) => runs[r.key]?.status === "done" && (r.cap.side_effects === "write" || hasInputs(r))).length;
  const totalCount = writes.length + reads.length;

  const tokenInfo = (b: Binding): TokenInfo => {
    if (b.kind === "prop") return { source: "Document", label: b.key[0]!.toUpperCase() + b.key.slice(1) };
    const src = refMap.get(b.cap);
    if (!src) return { source: "Missing", label: b.field };
    if (b.kind === "mirror") return { source: src.cap.title, label: "same as preview", origin: src.origin, siteName: src.siteName };
    return { source: `${stepOf.get(src.origin) ?? "?"} · ${src.siteName}`, label: b.field, origin: src.origin, siteName: src.siteName };
  };

  // ── Connecting a site ─────────────────────────────────────────────────────
  const traceStep = (origin: string, update: (steps: TraceStep[]) => TraceStep[]) =>
    setTrace((t) => (t && t.origin === origin ? { ...t, steps: update(t.steps) } : t));

  async function connect(raw: string) {
    setError(null);
    let target: string;
    try {
      target = new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
    } catch {
      return setError("Enter a site URL, for example http://localhost:4101");
    }
    if (conns.some((c) => c.site.site.origin === target)) return setError(`${hostOf(target)} is already connected`);
    setTrace({ origin: target, steps: [{ label: `Reading ${hostOf(target)}${MANIFEST_PATH}`, state: "doing" }] });
    try {
      const site = await discoverSite(target, AbortSignal.timeout(10_000));
      await pace();
      const writesN = site.capabilities.filter((c) => c.side_effects === "write").length;
      traceStep(target, () => [
        { label: `Read ${hostOf(target)}${MANIFEST_PATH}`, state: "done" },
        { label: `Manifest is bound to ${hostOf(target)} · ${site.capabilities.length} capabilities (${writesN} change the site)`, state: "done" },
        { label: `Opening ${site.site.name}'s bridge on its own origin`, state: "doing" },
      ]);
      await pace(180);
      setFresh((f) => new Set(f).add(target));
      setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(target); return n; }), 2600);
      setConns((cs) => [...cs, { key: nextKey.current++, site, status: "connecting" }]);
      setUrl("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      traceStep(target, (steps) => steps.map((s, i) => (i === steps.length - 1 ? { label: message, state: "failed" } : s)));
      setError(message);
    }
  }

  const onBridgeStatus = useCallback((site: Site, status: "ready" | "failed", failure?: string) => {
    const origin = site.site.origin;
    setConns((cs) => cs.map((c) => (c.site.site.origin === origin ? { ...c, status, failure } : c)));
    if (status === "failed") {
      traceStep(origin, (steps) => [...steps.slice(0, -1), { label: failure ?? "bridge refused", state: "failed" }]);
      return;
    }
    traceStep(origin, (steps) => [...steps.slice(0, -1), { label: `${site.site.name}'s bridge answered from ${hostOf(origin)}`, state: "done" }]);
    // Check Mosaic's own source fingerprint again: connecting a site must not need a Mosaic change.
    fetch("/mosaic-host.json")
      .then((r) => r.json())
      .then((now: HostInfo) => {
        setBuildCheck(firstBuild.current === now.build ? "same" : "changed");
        traceStep(origin, (steps) => [...steps, { label: `Blocks added to the runbook · Mosaic build ${now.build}, no redeploy`, state: "done" }]);
      })
      .catch(() => {});
    // Reads that need no input run at once, as context for the step.
    const client = clients.current.get(origin);
    for (const cap of site.capabilities) {
      if (cap.side_effects !== "read" || Object.keys(cap.input_schema.properties ?? {}).length > 0 || !client) continue;
      const key = capKey(origin, cap.id);
      setRuns((r) => ({ ...r, [key]: { status: "running" } }));
      client.invoke(cap.id, {}).then(
        (output) => setRuns((r) => ({ ...r, [key]: { status: "done", output, at: new Date() } })),
        (e: Error) => setRuns((r) => ({ ...r, [key]: { status: "error", message: e.message, denied: false, at: new Date() } })),
      );
    }
  }, []);

  const onConfirm = useCallback((origin: string, active: boolean) => {
    clearTimeout(lingerTimer.current);
    if (active) setConfirming(origin);
    // Leave the site's own sheet up briefly so its result ("Done", "Denied") is seen.
    else lingerTimer.current = setTimeout(() => setConfirming((c) => (c === origin ? null : c)), SHEET_LINGER_MS);
  }, []);

  function disconnect(origin: string) {
    clients.current.get(origin)?.close();
    clients.current.delete(origin);
    setConns((cs) => cs.filter((c) => c.site.site.origin !== origin));
  }

  // ── Running a block ───────────────────────────────────────────────────────
  function inputFor(r: CapRef): unknown {
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
  }

  async function run(r: CapRef): Promise<boolean> {
    let input: unknown;
    try {
      input = inputFor(r);
    } catch (e) {
      if (e instanceof FormError) {
        setRuns((s) => ({ ...s, [r.key]: { status: "error", message: e.message, denied: false, at: new Date() } }));
        return false;
      }
      throw e;
    }
    const client = clients.current.get(r.origin);
    if (!client) return false;
    setRuns((s) => ({ ...s, [r.key]: { status: "running" } }));
    const write = r.cap.side_effects === "write";
    try {
      const output = await client.invoke(r.cap.id, input);
      setRuns((s) => ({ ...s, [r.key]: { status: "done", output, at: new Date() } }));
      setPulse({ cap: r.key, at: Date.now() });
      record(r, write, "done", write ? `approved on ${hostOf(r.origin)}` : "read");
      return true;
    } catch (e) {
      const denied = e instanceof BridgeCallError && e.error.code === "denied";
      const message = e instanceof Error ? e.message : String(e);
      setRuns((s) => ({ ...s, [r.key]: { status: "error", message, denied, at: new Date() } }));
      record(r, write, denied ? "denied" : "failed", denied ? `denied on ${hostOf(r.origin)}, nothing changed` : message);
      return false;
    }
  }

  function record(r: CapRef, write: boolean, outcome: Receipt["outcome"], detail: string) {
    setReceipts((list) => [{ id: receiptId.current++, at: new Date(), origin: r.origin, siteName: r.siteName, title: r.cap.title, write, outcome, detail }, ...list].slice(0, 40));
  }

  async function sendAll() {
    setSending(true);
    try {
      for (const w of writes) {
        if (runs[w.key]?.status === "done") continue;
        if (!(await run(w))) break;
      }
    } finally {
      setSending(false);
    }
  }

  const setValue = (key: CapKey, field: string, v: string | boolean) => setManual((m) => ({ ...m, [key]: { ...m[key], [field]: v } }));
  const setBinding = (key: CapKey, field: string, b: Binding | null) => {
    setBindings((all) => ({ ...all, [key]: { ...all[key], [field]: b } }));
    if (b?.kind === "output") setPulse({ cap: b.cap, at: Date.now() });
  };

  const waitingOn = confirming ? connFor(confirming) : undefined;
  const pendingWrites = writes.filter((w) => runs[w.key]?.status !== "done");

  const blockProps = {
    runs,
    manual,
    lookup,
    refs,
    confirming,
    hot,
    fresh,
    stepOf,
    bindingFor,
    tokenInfo,
    setHot,
    setValue,
    setBinding,
    run,
    readyOf: (origin: string) => connFor(origin)?.status === "ready",
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <MosaicMark />
          <span>Mosaic</span>
        </div>
        <nav className="crumbs" aria-label="Location">
          <span className="dim">Runbooks</span>
          <span className="sep">/</span>
          <span className="crumb-title">{title.trim() || "Untitled"}</span>
        </nav>
        <div className="top-right">
          {host && (
            <span className={`build ${buildCheck ?? ""}`} title="Fingerprint of Mosaic's own source. It stays the same when you connect a site.">
              <span className="build-dot" />
              build <code data-testid="build">{host.build}</code>
              {buildCheck === "same" && <span className="build-note"> · no redeploy</span>}
            </span>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="rail" aria-label="Sources">
          <div className="rail-head">
            <h2>Sources</h2>
            <span className="count">{conns.length}</span>
          </div>
          <ul className="sources">
            {siteOrder.map((o) => {
              const c = connFor(o);
              return (
                <li key={c.key} className={`source ${c.status} ${fresh.has(o) ? "fresh" : ""}`} data-origin={o} style={hueStyle(o)}>
                  <div className="source-row">
                    <Monogram name={c.site.site.name} origin={o} ring={c.status === "connecting" ? "ring-running" : c.status === "failed" ? "ring-failed" : ""} />
                    <div className="source-id">
                      <div className="source-name">{c.site.site.name}</div>
                      <Origin origin={o} />
                    </div>
                    <span className={`status-dot ${c.status}`} title={c.status === "ready" ? "Bridge ready" : c.status === "failed" ? "Refused" : "Connecting"} />
                    <button className="icon-btn" onClick={() => disconnect(o)} aria-label={`Disconnect ${c.site.site.name}`}>
                      ×
                    </button>
                  </div>
                  {c.failure && <p className="source-fail">{c.failure}</p>}
                  <ul className="caps">
                    {c.site.capabilities.map((cap) => (
                      <li key={cap.id}>
                        <a href={`#cap-${domId(capKey(o, cap.id))}`} className={cap.side_effects}>
                          <span className="eff" aria-hidden="true" />
                          {cap.title}
                          {cap.side_effects === "write" && <span className="sr-only"> (changes the site)</span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <form
            className="add-site"
            onSubmit={(e) => {
              e.preventDefault();
              void connect(url);
            }}
          >
            <label htmlFor="site-url" className="add-label">
              Add a site
            </label>
            <div className="add-row">
              <input id="site-url" aria-label="Site URL" placeholder="https://… or localhost:4103" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
              <button disabled={!url.trim() || trace?.steps.some((s) => s.state === "doing")}>Connect</button>
            </div>
          </form>
          {error && (
            <p className="rail-error" role="alert">
              {error}
            </p>
          )}
          {trace && (
            <ol className="trace" aria-label="Connection steps" aria-live="polite">
              {trace.steps.map((s, i) => (
                <li key={i} className={s.state}>
                  <span className="trace-mark" aria-hidden="true" />
                  {s.label}
                </li>
              ))}
            </ol>
          )}
          <p className="rail-foot">Mosaic ships with no integrations. Every block in this runbook comes from a site's own manifest.</p>
        </aside>

        <main className="doc-scroll">
          <div className="doc" ref={docRef}>
            <Connectors container={docRef} pulse={pulse} />
            <header className="doc-head">
              <div className="kicker">
                Runbook · {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <input className="doc-title" aria-label="Outcome" value={title} placeholder="Describe the outcome, e.g. Launch Lumen v1.0" onChange={(e) => setTitle(e.target.value)} />
              <p className="lede">
                Each step runs on a different website, through capabilities that site publishes. Changes wait in <a href="#publish">Ready to publish</a> until you approve each one on its own site.
              </p>
              <dl className="props">
                {(["project", "version"] as const).map((k) => (
                  <div key={k} className="prop">
                    <dt>
                      <label htmlFor={`prop-${k}`}>{k === "project" ? "Project" : "Version"}</label>
                    </dt>
                    <dd>
                      <input
                        id={`prop-${k}`}
                        className="prop-input"
                        value={docProps[k]}
                        placeholder="—"
                        onChange={(e) => setOverrides((o) => ({ ...o, [k]: e.target.value }))}
                      />
                    </dd>
                  </div>
                ))}
                <div className="prop">
                  <dt>Sources</dt>
                  <dd className="prop-sources">
                    {siteOrder.length === 0 && <span className="dim">None yet</span>}
                    {siteOrder.map((o) => (
                      <Monogram key={o} name={connFor(o).site.site.name} origin={o} size="sm" />
                    ))}
                  </dd>
                </div>
                <div className="prop">
                  <dt>Progress</dt>
                  <dd className="prop-progress">
                    <span className="bar">
                      <span style={{ width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%` }} />
                    </span>
                    <span>
                      {doneCount} of {totalCount}
                      {waitingOn && <span className="waiting-note"> · approve on {hostOf(waitingOn.site.site.origin)}</span>}
                    </span>
                  </dd>
                </div>
              </dl>
            </header>

            {conns.length === 0 && <EmptyState suggestions={host?.suggestions ?? []} onPick={(s) => void connect(s)} />}

            {siteOrder.map((o) => (
              <Step key={o} conn={connFor(o)} number={stepOf.get(o)!} {...blockProps} publishNumber={siteOrder.length + 1} />
            ))}

            {writes.length > 0 && (
              <section className="publish" id="publish">
                <div className="step-gutter">
                  <span className={`step-num publish-num ${pendingWrites.length === 0 ? "done" : ""}`}>{siteOrder.length + 1}</span>
                </div>
                <header className="publish-head">
                  <div>
                    <h2>Ready to publish</h2>
                    <p className="step-sub">
                      {writes.length} change{writes.length === 1 ? "" : "s"} on {new Set(writes.map((w) => w.origin)).size} site{new Set(writes.map((w) => w.origin)).size === 1 ? "" : "s"}. Each one opens that site's own approval
                      prompt. Mosaic cannot approve for you.
                    </p>
                  </div>
                  <button className="btn primary" onClick={() => void sendAll()} disabled={sending || pendingWrites.length === 0 || !!confirming}>
                    {pendingWrites.length === 0 ? "All published" : `Review ${pendingWrites.length} on their sites`}
                  </button>
                </header>
                <div className="publish-list">
                  {writes.map((w) => (
                    <WriteCard key={w.key} r={w} {...blockProps} />
                  ))}
                </div>
              </section>
            )}

            {receipts.length > 0 && (
              <section className="activity" aria-label="Activity">
                <h2>Activity</h2>
                <ol>
                  {receipts.map((rc) => (
                    <li key={rc.id} className={`${rc.outcome} ${rc.write ? "write" : "read"}`}>
                      <span className="act-mark" aria-hidden="true">
                        {rc.outcome === "done" ? (rc.write ? "✓" : "·") : "✕"}
                      </span>
                      <span className="act-title">{rc.title}</span>
                      <Provenance name={rc.siteName} origin={rc.origin} />
                      <span className="act-detail">{rc.detail}</span>
                      <time>{fmtTime(rc.at)}</time>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </main>
      </div>

      <div className={`sheet-layer ${confirming ? "open" : ""}`} aria-hidden={!confirming}>
        <div className="sheet-backdrop" />
        <div className="sheet-stage">
          {waitingOn && (
            <div className="sheet-label" style={hueStyle(waitingOn.site.site.origin)}>
              <span className="lock-glyph" aria-hidden="true" />
              <span>
                Shown by <b>{hostOf(waitingOn.site.site.origin)}</b>. Mosaic can't see or press this.
              </span>
            </div>
          )}
          {conns.map((c) => (
            <BridgeFrame
              key={c.key}
              site={c.site}
              visible={confirming === c.site.site.origin}
              register={(client) => clients.current.set(c.site.site.origin, client)}
              onStatus={onBridgeStatus}
              onConfirm={onConfirm}
            />
          ))}
          {waitingOn && <div className="sheet-wait">Waiting for you to answer {waitingOn.site.site.name}</div>}
        </div>
      </div>
    </div>
  );
}

function MosaicMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mark">
      <rect x="1" y="1" width="8" height="11" rx="2" />
      <rect x="11" y="1" width="8" height="6" rx="2" />
      <rect x="1" y="14" width="8" height="5" rx="2" />
      <rect x="11" y="9" width="8" height="10" rx="2" />
    </svg>
  );
}

function EmptyState({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <section className="empty">
      {[1, 2, 3].map((n) => (
        <div key={n} className="ghost-step">
          <span className="step-num ghost">{n}</span>
          <div className="ghost-lines">
            <span />
            <span />
          </div>
        </div>
      ))}
      <div className="empty-card">
        <h2>Add the sites this outcome needs</h2>
        <p>Paste a site's address under Sources. Mosaic reads the capabilities it publishes and writes them into this runbook as steps you can run. Nothing about the site is built into Mosaic.</p>
        {suggestions.length > 0 && (
          <div className="suggest">
            <span className="dim">Try</span>
            {suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => onPick(s)}>
                {hostOf(s)}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── A step: one site's part of the runbook ──────────────────────────────────

type BlockProps = {
  runs: Record<CapKey, Run>;
  manual: Record<CapKey, FormValues>;
  lookup: Lookup;
  refs: CapRef[];
  confirming: string | null;
  hot: CapKey | null;
  fresh: Set<string>;
  stepOf: Map<string, number>;
  bindingFor: (key: CapKey, field: string) => Binding | null;
  tokenInfo: (b: Binding) => TokenInfo;
  setHot: (k: CapKey | null) => void;
  setValue: (key: CapKey, field: string, v: string | boolean) => void;
  setBinding: (key: CapKey, field: string, b: Binding | null) => void;
  run: (r: CapRef) => Promise<boolean>;
  readyOf: (origin: string) => boolean;
};

function Step(props: BlockProps & { conn: Conn; number: number; publishNumber: number }) {
  const { conn, number } = props;
  const origin = conn.site.site.origin;
  const mine = props.refs.filter((r) => r.origin === origin);
  const context = mine.filter((r) => r.cap.side_effects === "read" && !hasInputs(r));
  const reads = mine.filter((r) => r.cap.side_effects === "read" && hasInputs(r));
  const writes = mine.filter((r) => r.cap.side_effects === "write");
  const lead = reads[0];
  const states = reads.map((r) => props.runs[r.key]?.status ?? "idle");
  const state = states.includes("running") ? "running" : states.includes("error") ? "error" : states.length && states.every((s) => s === "done") ? "done" : "idle";
  return (
    <section className={`step ${props.fresh.has(origin) ? "fresh" : ""}`} data-origin={origin} style={hueStyle(origin)} aria-labelledby={`step-${number}`}>
      <div className="step-gutter">
        <span className={`step-num ${state}`}>{state === "done" ? <span aria-label={`Step ${number} done`}>✓</span> : number}</span>
      </div>
      <header className="step-head">
        <h2 id={`step-${number}`}>{lead?.cap.title ?? conn.site.site.name}</h2>
        <Provenance name={conn.site.site.name} origin={origin} />
        {props.fresh.has(origin) && <span className="new-pill">New · built from its manifest</span>}
      </header>
      <div className="step-gap" />
      {conn.status === "failed" && <p className="block-error">This site refused Mosaic: {conn.failure}</p>}

      {context.map((r) => (
        <ContextLine key={r.key} r={r} run={props.runs[r.key]} />
      ))}
      {reads.map((r, i) => (
        <ReadBlock key={r.key} r={r} showTitle={i > 0} {...props} />
      ))}
      {reads.length === 0 && writes.length > 0 && <p className="step-note">This site only offers changes. They are listed under Ready to publish.</p>}
      {writes.length > 0 && (
        <p className="then">
          <span className="diamond" aria-hidden="true" />
          Then {writes.map((w) => w.cap.title.toLowerCase()).join(" and ")}, in step {props.publishNumber} after your approval on {hostOf(origin)}.
        </p>
      )}
    </section>
  );
}

function ContextLine({ r, run }: { r: CapRef; run?: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="context cap" data-capability={r.cap.id} data-origin={r.origin} id={`cap-${domId(r.key)}`}>
      <button type="button" className="context-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ctx-title">{r.cap.title}</span>
        <span className="ctx-sum">
          {run?.status === "done" ? summarize(run.output) : run?.status === "error" ? run.message : run?.status === "running" ? "Reading…" : "Not read yet"}
        </span>
        <span className="chev" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && run?.status === "done" && (
        <div className="output context-out">
          <OutputView value={run.output} origin={r.origin} />
        </div>
      )}
    </div>
  );
}

function summarize(output: unknown): string {
  if (output && typeof output === "object") {
    const arr = Object.values(output).find(Array.isArray) as unknown[] | undefined;
    if (arr) {
      const first = arr[0] as Record<string, unknown> | undefined;
      const label = first ? Object.values(first).find((v) => typeof v === "string") : undefined;
      return `${arr.length} item${arr.length === 1 ? "" : "s"}${label ? ` · latest ${label}` : ""}`;
    }
  }
  return preview(typeof output === "string" ? output : JSON.stringify(output), 60);
}

function ReadBlock(props: BlockProps & { r: CapRef; showTitle: boolean }) {
  const { r } = props;
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const run = props.runs[r.key] ?? { status: "idle" };
  const ready = props.readyOf(r.origin);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const doneAt = run.status === "done" ? run.at.getTime() : 0;
  // Once a block has run, its inputs fold into one sentence and its output becomes the content.
  useEffect(() => setEditing(false), [doneAt]);
  const collapsed = run.status === "done" && !editing;
  const outs = outputFields(r.cap);
  const usedBy = props.refs.filter((o) => o.key !== r.key && Object.keys(o.cap.input_schema.properties ?? {}).some((f) => {
    const b = props.bindingFor(o.key, f);
    return b?.kind === "output" && b.cap === r.key;
  }));
  return (
    <article
      className={`block cap ${props.hot === r.key ? "hot" : ""} ${run.status}`}
      data-capability={r.cap.id}
      data-origin={r.origin}
      data-flow-anchor={r.key}
      id={`cap-${domId(r.key)}`}
    >
      {props.showTitle && <h3 className="block-title">{r.cap.title}</h3>}
      <p className="block-desc">{r.cap.description}</p>
      {collapsed ? (
        <div className="inputs-summary">
          {fields.map((f) => (
            <SummaryItem {...props} key={f.key} r={r} field={f} />
          ))}
          <span className="sum-actions">
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit inputs
            </button>
            <button type="button" className="link-btn" onClick={() => void props.run(r)} disabled={!ready}>
              Run again
            </button>
          </span>
        </div>
      ) : (
        <>
          <div className="fields">
            {fields.map((f) => (
              <FieldRow {...props} key={f.key} r={r} field={f} />
            ))}
          </div>
          <div className="block-actions">
            <button className="btn run" onClick={() => void props.run(r)} disabled={!ready || run.status === "running"}>
              <span className="play" aria-hidden="true" />
              {run.status === "running" ? "Running…" : r.cap.title}
            </button>
            <span className="hint">Read only · nothing changes on {hostOf(r.origin)}</span>
            <button type="button" className="link-btn" onClick={() => setSchemaOpen((s) => !s)} aria-expanded={schemaOpen}>
              {schemaOpen ? "Hide schema" : "Schema"}
            </button>
          </div>
        </>
      )}
      {schemaOpen && <pre className="schema">{JSON.stringify(r.cap.input_schema, null, 2)}</pre>}
      {run.status === "error" && <p className="block-error output-error">{run.message}</p>}
      {run.status === "done" && (
        <div className="output">
          <OutputView value={run.output} origin={r.origin} />
          {outs.length > 0 && (
            <div className="feeds">
              <span className="feeds-label">Outputs</span>
              {outs.map((f) => {
                const v = (run.output as Record<string, unknown> | null)?.[f];
                if (v === undefined) return null;
                const used = usedBy.some((u) => Object.keys(u.cap.input_schema.properties ?? {}).some((k) => {
                  const b = props.bindingFor(u.key, k);
                  return b?.kind === "output" && b.cap === r.key && b.field === f;
                }));
                return (
                  <span key={f} className={`out-token ${used ? "used" : ""}`} data-flow-src={`${r.key}|${f}`} style={hueStyle(r.origin)}>
                    <Monogram name={r.siteName} origin={r.origin} size="sm" />
                    {f}
                  </span>
                );
              })}
              {usedBy.length > 0 && <span className="feeds-used">used by {usedBy.map((u) => u.cap.title).join(", ")}</span>}
              <RawOutput value={run.output} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** The exact output, behind a disclosure. Rendered only when open, so it never competes with the content view. */
function RawOutput({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`raw ${open ? "open" : ""}`}>
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide raw" : "Raw"}
      </button>
      {open && <pre>{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

/** One input, folded into the block's summary sentence after it has run. */
function SummaryItem(props: BlockProps & { r: CapRef; field: Field }) {
  const { r, field } = props;
  const binding = props.bindingFor(r.key, field.key);
  const raw = props.manual[r.key]?.[field.key] ?? field.initial;
  const res = resolve(binding, props.lookup);
  let shown: string;
  if (binding && binding.kind !== "prop") shown = "";
  else if (res.state === "value") shown = res.value;
  else if (field.kind === "list") {
    const n = String(raw).split("\n").filter((x) => x.trim()).length;
    shown = `${n} item${n === 1 ? "" : "s"}`;
  } else if (field.kind === "boolean") shown = raw === true ? "yes" : "no";
  else if (field.kind === "datetime") shown = raw ? String(raw).replace("T", " ") : "now";
  else shown = String(raw);
  if (!shown && !binding) return null;
  return (
    <span className="sum-item">
      <span className="sum-label">{field.label.replace(/\s*\(.*\)$/, "")}</span>
      {binding && binding.kind !== "prop" ? (
        <span data-flow-dst={binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined}>
          <Token info={props.tokenInfo(binding)} onHover={(on) => props.setHot(on ? binding.cap : null)} />
        </span>
      ) : (
        <b>{preview(shown, 40)}</b>
      )}
    </span>
  );
}

function FieldRow(props: BlockProps & { r: CapRef; field: Field; compact?: boolean }) {
  const { r, field } = props;
  const id = `f-${domId(r.key)}-${field.key}`;
  const binding = props.bindingFor(r.key, field.key);
  const resolved = resolve(binding, props.lookup);
  const raw = props.manual[r.key]?.[field.key] ?? field.initial;
  const isFresh = props.fresh.has(r.origin);
  const auto = binding !== null && sameBinding(binding, autoBinding(r, field.key, props.refs, props.lookup.docProps));
  const textish = field.kind === "textarea";
  const empty = typeof raw === "string" && raw.trim() === "";
  // Outputs of other blocks this field could take, offered when it is empty.
  const suggestions =
    !binding && textish && empty
      ? props.refs
          .filter((o) => o.key !== r.key && o.cap.side_effects === "read")
          .flatMap((o) => outputFields(o.cap).map((f) => ({ kind: "output", cap: o.key, field: f }) as Binding))
          .filter((b) => b.kind === "output" && !["before", "path"].includes(b.field))
          .slice(0, 3)
      : [];
  const srcKey = binding && binding.kind !== "prop" ? binding.cap : null;
  return (
    <div className={`field-row ${isFresh ? "fresh" : ""} ${binding ? "bound" : ""} ${field.kind}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {field.label}
        {field.required && !binding && <span className="req" aria-label="required">*</span>}
      </label>
      <div className="field-val">
        {isFresh && (
          <code className="schema-ghost" aria-hidden="true">
            {field.key}: {schemaType(field)}
          </code>
        )}
        {binding ? (
          <div className="bound-val" data-flow-dst={binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined}>
            <div className="bound-line">
              {resolved.state === "value" && field.kind !== "textarea" && field.kind !== "list" && <span className="bound-preview">{preview(resolved.value, 48)}</span>}
              <Token
                info={props.tokenInfo(binding)}
                pending={resolved.state === "pending"}
                onHover={(on) => props.setHot(on && srcKey ? srcKey : null)}
                onRemove={() => props.setBinding(r.key, field.key, null)}
                removeLabel={`Type ${field.label} by hand`}
              />
              {resolved.state === "pending" && <span className="bound-preview dim">fills in when that step runs</span>}
              {!auto && <span className="bound-tag">linked by you</span>}
            </div>
            {resolved.state === "value" && (field.kind === "textarea" || field.kind === "list") && (
              <div className="bound-content">
                <Markdown source={resolved.value} />
              </div>
            )}
          </div>
        ) : (
          <>
            <Control field={field} id={id} value={raw} onChange={(v) => props.setValue(r.key, field.key, v)} />
            {suggestions.length > 0 && (
              <div className="suggestions">
                <span className="dim">Use</span>
                {suggestions.map((b) => (
                  <button
                    type="button"
                    key={JSON.stringify(b)}
                    className="suggest-btn"
                    aria-label={`Use ${props.tokenInfo(b).siteName} ${props.tokenInfo(b).label}`}
                    onClick={() => props.setBinding(r.key, field.key, b)}
                  >
                    <Token info={props.tokenInfo(b)} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── A write, gathered at the end for review ─────────────────────────────────

function WriteCard(props: BlockProps & { r: CapRef }) {
  const { r } = props;
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const run = props.runs[r.key] ?? { status: "idle" };
  const waiting = run.status === "running" && props.confirming === r.origin;
  const ready = props.readyOf(r.origin);
  const host = hostOf(r.origin);
  const state = waiting ? "waiting" : run.status;
  return (
    <article className={`write-card cap ${state}`} data-capability={r.cap.id} data-origin={r.origin} id={`cap-${domId(r.key)}`} style={hueStyle(r.origin)}>
      <header className="wc-head">
        <span className={`wc-icon ${state}`} aria-hidden="true">
          <span>{run.status === "done" ? "✓" : run.status === "error" ? "✕" : ""}</span>
        </span>
        <h3>{r.cap.title}</h3>
        <span className="changes-tag">Changes {props.refs.find((x) => x.origin === r.origin)?.siteName}</span>
        <Provenance name={r.siteName} origin={r.origin} />
      </header>
      <div className="fields compact">
        {fields.map((f) => (
          <FieldRow {...props} key={f.key} r={r} field={f} compact />
        ))}
      </div>
      <footer className="wc-foot">
        {run.status === "done" ? (
          <div className="output receipt">
            <span className="receipt-check" aria-hidden="true">
              ✓
            </span>
            <span>
              Approved on <b>{host}</b> · {fmtTime(run.at)}
            </span>
            <OutputLinks output={run.output} origin={r.origin} />
          </div>
        ) : (
          <>
            <button className="btn write" onClick={() => void props.run(r)} disabled={!ready || run.status === "running"}>
              {waiting ? `Waiting for ${host}…` : r.cap.title}
            </button>
            <span className="hint">{waiting ? `Answer the prompt from ${host}` : `Opens ${host}'s own approval prompt`}</span>
          </>
        )}
      </footer>
      {run.status === "error" && (
        <p className={`block-error output-error ${run.denied ? "denied" : ""}`}>
          {run.denied ? `Denied on ${host}: the person denied this action. Nothing changed.` : run.message}
        </p>
      )}
    </article>
  );
}

function OutputLinks({ output, origin }: { output: unknown; origin: string }) {
  if (!output || typeof output !== "object") return null;
  const entries = Object.entries(output as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number");
  return (
    <span className="receipt-links">
      {entries.map(([k, v]) =>
        typeof v === "string" && v.startsWith("/") ? (
          <a key={k} href={new URL(v, origin).href} target="_blank" rel="noreferrer">
            {v} ↗
          </a>
        ) : null,
      )}
    </span>
  );
}

// ── The site's own bridge, and the sheet it shows ───────────────────────────

function BridgeFrame(props: {
  site: Site;
  visible: boolean;
  register: (client: BridgeClient) => void;
  onStatus: (site: Site, status: "ready" | "failed", failure?: string) => void;
  onConfirm: (origin: string, active: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const origin = props.site.site.origin;
    const client = new BridgeClient(props.site, frame.current!, (id) => props.onConfirm(origin, id !== null));
    props.register(client);
    client.ready.then(
      () => props.onStatus(props.site, "ready"),
      (e: Error) => props.onStatus(props.site, "failed", e.message),
    );
    return () => client.close();
    // Keyed by connection: the site never changes for one instance.
  }, []);
  return <iframe ref={frame} className={props.visible ? "bridge visible" : "bridge"} data-origin={props.site.site.origin} title={`${props.site.site.name} approval`} />;
}

// ── Connectors: lines in the gutter from an output to the inputs it fills ───

type Path = { d: string; hue: number; live: boolean; pending: boolean; end: [number, number]; id: string };

function Connectors({ container, pulse }: { container: RefObject<HTMLDivElement | null>; pulse: { cap: CapKey; at: number } | null }) {
  const [paths, setPaths] = useState<Path[]>([]);
  const last = useRef("");
  const measure = useCallback(() => {
    const box = container.current;
    if (!box || box.clientWidth < 640) {
      if (last.current !== "[]") setPaths([]);
      last.current = "[]";
      return;
    }
    const b = box.getBoundingClientRect();
    const lanes = new Map<string, number>();
    const out: Path[] = [];
    box.querySelectorAll<HTMLElement>("[data-flow-dst]").forEach((dst) => {
      const ref = dst.dataset.flowDst!;
      const [cap] = ref.split("|");
      const src = box.querySelector<HTMLElement>(`[data-flow-src="${CSS.escape(ref)}"]`);
      const anchor = src ?? box.querySelector<HTMLElement>(`[data-flow-anchor="${CSS.escape(cap!)}"]`);
      if (!anchor) return;
      if (!lanes.has(ref)) lanes.set(ref, lanes.size);
      const lane = lanes.get(ref)!;
      const s = anchor.getBoundingClientRect();
      const t = dst.getBoundingClientRect();
      const sx = (src ? s.left : s.left + 4) - b.left;
      const sy = (src ? s.top + s.height / 2 : s.top + 14) - b.top;
      const tx = t.left - b.left - 4;
      const ty = t.top + 13 - b.top;
      const x = 14 + lane * 8;
      const r = Math.min(10, Math.abs(ty - sy) / 2);
      const dir = ty >= sy ? 1 : -1;
      const d = `M ${sx} ${sy} H ${x + r} Q ${x} ${sy} ${x} ${sy + r * dir} V ${ty - r * dir} Q ${x} ${ty} ${x + r} ${ty} H ${tx}`;
      const hue = Number(getComputedStyle(dst.closest("[style*='--h']") ?? anchor).getPropertyValue("--h")) || 0;
      const srcHue = Number(getComputedStyle(anchor.closest("[style*='--h']") ?? anchor).getPropertyValue("--h")) || hue;
      out.push({ d, hue: srcHue, live: false, pending: !src, end: [tx, ty], id: `${ref}->${out.length}` });
    });
    const key = JSON.stringify(out);
    if (key !== last.current) {
      last.current = key;
      setPaths(out);
    }
  }, [container]);

  useLayoutEffect(measure);
  useEffect(() => {
    const box = container.current;
    if (!box) return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, container]);

  return (
    <svg className="connectors" aria-hidden="true">
      {paths.map((p) => {
        const live = pulse && p.id.startsWith(pulse.cap + "|") && Date.now() - pulse.at < 1200;
        return (
          <g key={p.id + (live ? pulse!.at : "")} style={{ "--h": String(p.hue) } as React.CSSProperties} className={`${p.pending ? "pending" : ""} ${live ? "live" : ""}`}>
            <path d={p.d} className="wire" />
            <circle cx={p.end[0]} cy={p.end[1]} r="2.5" className="wire-end" />
          </g>
        );
      })}
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
