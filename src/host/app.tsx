import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { compileForm, FormError, initialValues, toInput, type Field, type FormValues } from "../form";
import { discoverSite, type Capability, type Site } from "../protocol";
import { BridgeCallError, BridgeClient } from "./bridge-client";

type Connection = { key: number; site: Site };
type LogEntry = { at: string; site: string; capability: string; outcome: string };

function App() {
  const [url, setUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const nextKey = useRef(1);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let target: string;
    try {
      target = new URL(url.includes("://") ? url : `https://${url}`).origin;
    } catch {
      return setError("Enter a site URL, for example http://localhost:4101");
    }
    if (connections.some((c) => c.site.site.origin === target)) return setError(`${target} is already connected`);
    setBusy(true);
    try {
      const site = await discoverSite(target, AbortSignal.timeout(10_000));
      setConnections((cs) => [...cs, { key: nextKey.current++, site }]);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onConfirmChange(origin: string, active: boolean) {
    setConfirming((prev) => {
      const next = new Set(prev);
      if (active) next.add(origin);
      else next.delete(origin);
      return next;
    });
  }

  const record = (entry: Omit<LogEntry, "at">) => setLog((l) => [{ at: new Date().toLocaleTimeString(), ...entry }, ...l].slice(0, 50));

  return (
    <div className="shell">
      <header>
        <div className="brand">mosaic</div>
        <div className="meta">
          {connections.length} site{connections.length === 1 ? "" : "s"} connected
          {confirming.size > 0 && <span className="badge write">{confirming.size} waiting for approval</span>}
        </div>
      </header>

      <form className="connect" onSubmit={connect}>
        <input aria-label="Site URL" placeholder="Connect a site: https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button disabled={busy || !url.trim()}>{busy ? "Discovering…" : "Connect"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {connections.length === 0 && (
        <p className="empty">Connect a site that publishes a Mosaic capability manifest. Its capabilities become controls here.</p>
      )}

      <main className="grid">
        {connections.map((c) => (
          <SitePanel
            key={c.key}
            site={c.site}
            onConfirmChange={(active) => onConfirmChange(c.site.site.origin, active)}
            onRecord={record}
            onRemove={() => setConnections((cs) => cs.filter((x) => x.key !== c.key))}
          />
        ))}
      </main>

      {confirming.size > 0 && <div className="backdrop" />}

      {log.length > 0 && (
        <section className="log">
          <h2>Activity</h2>
          <ul>
            {log.map((l, i) => (
              <li key={i}>
                <time>{l.at}</time> <b>{l.site}</b> · {l.capability} · {l.outcome}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SitePanel(props: {
  site: Site;
  onConfirmChange: (active: boolean) => void;
  onRecord: (entry: Omit<LogEntry, "at">) => void;
  onRemove: () => void;
}) {
  const { site } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "failed">("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [showFrame, setShowFrame] = useState(false);

  useEffect(() => {
    const c = new BridgeClient(site, frame.current!, (id) => {
      setShowFrame(id !== null);
      props.onConfirmChange(id !== null);
    });
    setClient(c);
    c.ready.then(
      () => setStatus("ready"),
      (e: Error) => {
        setStatus("failed");
        setFailure(e.message);
      },
    );
    return () => c.close();
    // The panel is keyed by connection, so the site never changes for one instance.
  }, []);

  return (
    <section className="site" data-origin={site.site.origin}>
      <div className="site-head">
        <div>
          <h2>{site.site.name}</h2>
          <div className="origin">{site.site.origin}</div>
        </div>
        <span className={`badge ${status}`}>{status === "ready" ? "Ready" : status === "failed" ? "Refused" : "Connecting"}</span>
        <button className="ghost" onClick={props.onRemove} aria-label={`Disconnect ${site.site.name}`}>×</button>
      </div>
      {site.site.description && <p className="desc">{site.site.description}</p>}
      {failure && <p className="error">{failure}</p>}
      {site.capabilities.map((capability) => (
        <CapabilityWidget
          key={capability.id}
          capability={capability}
          disabled={status !== "ready"}
          run={(input) => client!.invoke(capability.id, input)}
          onRecord={(outcome) => props.onRecord({ site: site.site.name, capability: capability.title, outcome })}
        />
      ))}
      <iframe ref={frame} className={showFrame ? "bridge visible" : "bridge"} title={`${site.site.name} approval`} />
    </section>
  );
}

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; output: unknown }
  | { status: "error"; message: string };

function CapabilityWidget(props: {
  capability: Capability;
  disabled: boolean;
  run: (input: unknown) => Promise<unknown>;
  onRecord: (outcome: string) => void;
}) {
  const { capability } = props;
  const fields = useMemo(() => compileForm(capability.input_schema), [capability]);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [state, setState] = useState<RunState>({ status: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let input: unknown;
    try {
      input = toInput(fields, values);
    } catch (e) {
      if (e instanceof FormError) return setState({ status: "error", message: e.message });
      throw e;
    }
    setState({ status: "running" });
    try {
      const output = await props.run(input);
      setState({ status: "done", output });
      props.onRecord(capability.side_effects === "write" ? "approved and done" : "done");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: "error", message });
      props.onRecord(e instanceof BridgeCallError ? e.error.code : "failed");
    }
  }

  return (
    <form className="widget" data-capability={capability.id} onSubmit={submit}>
      <div className="widget-head">
        <h3>{capability.title}</h3>
        <span className={`badge ${capability.side_effects}`}>{capability.side_effects === "write" ? "Changes the site" : "Read only"}</span>
      </div>
      <p className="desc">{capability.description}</p>
      {fields.map((f) => (
        <FieldInput key={f.key} field={f} value={values[f.key] ?? f.initial} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
      ))}
      <button disabled={props.disabled || state.status === "running"}>
        {state.status === "running" ? (capability.side_effects === "write" ? "Waiting for approval…" : "Running…") : capability.title}
      </button>
      {state.status === "error" && <p className="error output-error">{state.message}</p>}
      {state.status === "done" && (
        <div className="output">
          <OutputView value={state.output} />
        </div>
      )}
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const id = useMemo(() => `f-${crypto.randomUUID()}`, []);
  const label = (
    <label htmlFor={id}>
      {field.label}
      {field.required && <span className="req"> *</span>}
    </label>
  );
  switch (field.kind) {
    case "boolean":
      return (
        <div className="field check">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </div>
      );
    case "select":
      return (
        <div className="field">
          {label}
          <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {field.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    case "textarea":
    case "list":
    case "json":
      return (
        <div className="field">
          {label}
          <textarea id={id} rows={field.kind === "textarea" ? 4 : 3} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "text":
    case "number":
    case "integer":
      return (
        <div className="field">
          {label}
          <input id={id} inputMode={field.kind === "text" ? undefined : "decimal"} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

function OutputView({ value }: { value: unknown }) {
  if (typeof value === "string") return value.includes("\n") ? <pre>{value}</pre> : <span>{value}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">none</span>;
    return (
      <ol>
        {value.map((v, i) => (
          <li key={i}>
            <OutputView value={v} />
          </li>
        ))}
      </ol>
    );
  }
  if (value && typeof value === "object") {
    return (
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <OutputView value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

createRoot(document.getElementById("root")!).render(<App />);
