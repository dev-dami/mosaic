import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { Field } from "../form";
import { diffLines, hostOf, hueOf, looksLikeMarkdown, monogram, originParts, parseInline, parseMarkdown, preview } from "./doc";

export const hueStyle = (origin: string) => ({ "--h": String(hueOf(origin)) }) as CSSProperties;

// ── Provenance ────────────────────────────────────────────────────────────────

export function Monogram({ name, origin, size = "md", ring }: { name: string; origin: string; size?: "sm" | "md" | "lg"; ring?: string }) {
  return (
    <span className={`mono-chip ${size} ${ring ?? ""}`} style={hueStyle(origin)} aria-hidden="true">
      {monogram(name)}
    </span>
  );
}

export function Origin({ origin }: { origin: string }) {
  const { lead, main, tail } = originParts(origin);
  return (
    <span className="origin">
      <span className="dim">{lead}</span>
      {main}
      <span className="dim">{tail}</span>
    </span>
  );
}

/** Host-drawn provenance row: monogram, site name, origin. Sites never draw this themselves. */
export function Provenance({ name, origin }: { name: string; origin: string }) {
  return (
    <span className="provenance" style={hueStyle(origin)} title={`Runs on ${origin}`}>
      <Monogram name={name} origin={origin} size="sm" />
      <span className="pv-name">{name}</span>
      <Origin origin={origin} />
    </span>
  );
}

// ── Tokens (a value that comes from somewhere else) ───────────────────────────

export type TokenInfo = { label: string; source: string; origin?: string; siteName?: string };

export function Token(props: { info: TokenInfo; pending?: boolean; onHover?: (on: boolean) => void; onRemove?: () => void; removeLabel?: string }) {
  const { info } = props;
  return (
    <span
      className={`token ${info.origin ? "site-tk" : "doc-tk"} ${props.pending ? "pending" : ""}`}
      style={info.origin ? hueStyle(info.origin) : undefined}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      {info.origin && info.siteName ? <Monogram name={info.siteName} origin={info.origin} size="sm" /> : <span className="tk-doc">¶</span>}
      <span className="tk-source">{info.source}</span>
      <span className="tk-sep">›</span>
      <span className="tk-label">{info.label}</span>
      {props.onRemove && (
        <button type="button" className="tk-x" aria-label={props.removeLabel ?? "Unlink"} onClick={props.onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

// ── Rendered content ──────────────────────────────────────────────────────────

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.t === "code" ? <code key={i}>{part.text}</code> : part.t === "strong" ? <strong key={i}>{part.text}</strong> : part.t === "em" ? <em key={i}>{part.text}</em> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={`md ${className ?? ""}`}>
      {parseMarkdown(source).map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = (`h${Math.min(b.level + 2, 6)}`) as "h3";
            return (
              <H key={i}>
                <Inline text={b.text} />
              </H>
            );
          }
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case "code":
            return <pre key={i}>{b.text}</pre>;
          case "p":
            return b.text.startsWith(">") ? (
              <blockquote key={i}>
                <Inline text={b.text.replace(/^>\s*/, "")} />
              </blockquote>
            ) : (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

export function Diff({ path, before, after }: { path?: string; before: string; after: string }) {
  const lines = diffLines(before, after);
  const added = lines.filter((l) => l.op === "+").length;
  const removed = lines.filter((l) => l.op === "-").length;
  return (
    <figure className="diff">
      <figcaption>
        <span className="diff-path">{path ?? "change"}</span>
        <span className="diff-stat">
          <span className="add">+{added}</span> <span className="del">−{removed}</span>
        </span>
      </figcaption>
      <div className="diff-body" role="table" aria-label="Proposed change">
        {lines.map((l, i) => (
          <div key={i} className={`dl ${l.op === "+" ? "add" : l.op === "-" ? "del" : ""}`} role="row">
            <span className="dl-op" aria-hidden="true">
              {l.op === " " ? "" : l.op === "+" ? "+" : "−"}
            </span>
            <span className="dl-text">{l.text || " "}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Scalar({ value, origin, k }: { value: unknown; origin: string; k: string }) {
  if (isIsoDate(value)) return <time dateTime={value}>{fmtDate(value)}</time>;
  if (typeof value === "string" && (k === "url" || k.endsWith("_url")) && value.startsWith("/")) {
    return (
      <a href={new URL(value, origin).href} target="_blank" rel="noreferrer">
        {value} ↗
      </a>
    );
  }
  if (typeof value === "string" && looksLikeMarkdown(value)) return <Markdown source={value} />;
  if (typeof value === "object" && value !== null) return <code>{preview(JSON.stringify(value), 80)}</code>;
  return <span>{String(value)}</span>;
}

/**
 * Show a result as content: a before/after pair as a coloured diff, markdown as rendered text,
 * lists of records as a compact table. Shapes, not site names, decide the view.
 */
export function OutputView({ value, origin }: { value: unknown; origin: string }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value) ? <RecordTable rows={value} origin={origin} /> : <Scalar value={value} origin={origin} k="" />;
  }
  const obj = value as Record<string, unknown>;
  const parts: ReactNode[] = [];
  const used = new Set<string>();
  if (typeof obj.before === "string" && typeof obj.after === "string") {
    parts.push(<Diff key="diff" path={typeof obj.path === "string" ? obj.path : undefined} before={obj.before} after={obj.after} />);
    ["before", "after", "path"].forEach((k) => used.add(k));
  }
  for (const [k, v] of Object.entries(obj)) {
    if (used.has(k)) continue;
    if (typeof v === "string" && looksLikeMarkdown(v)) {
      parts.push(
        <div className="content-card" key={k}>
          <Markdown source={v} />
        </div>,
      );
      used.add(k);
    } else if (Array.isArray(v)) {
      parts.push(<RecordTable key={k} rows={v} origin={origin} caption={k} />);
      used.add(k);
    }
  }
  const rest = Object.entries(obj).filter(([k]) => !used.has(k));
  if (rest.length) {
    parts.push(
      <dl className="meta-list" key="meta">
        {rest.map(([k, v]) => (
          <div key={k}>
            <dt>{k.replace(/_/g, " ")}</dt>
            <dd>
              <Scalar value={v} origin={origin} k={k} />
            </dd>
          </div>
        ))}
      </dl>,
    );
  }
  return <>{parts}</>;
}

function RecordTable({ rows, origin, caption }: { rows: unknown[]; origin: string; caption?: string }) {
  if (rows.length === 0) return <p className="muted">No {caption ?? "items"} yet.</p>;
  const records = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
  if (records.length !== rows.length) {
    return (
      <ul className="plain-list">
        {rows.map((r, i) => (
          <li key={i}>
            <Scalar value={r} origin={origin} k="" />
          </li>
        ))}
      </ul>
    );
  }
  const cols = [...new Set(records.flatMap((r) => Object.keys(r)))].slice(0, 4);
  return (
    <table className="records">
      {caption && <caption>{caption.replace(/_/g, " ")}</caption>}
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c}>{c.replace(/_/g, " ")}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.slice(0, 6).map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c}>{r[c] === undefined ? "—" : isIsoDate(r[c]) ? fmtDate(r[c] as string) : preview(String(typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]), 48)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Field controls ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function Control({ field, id, value, onChange }: { field: Field; id: string; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const [previewing, setPreviewing] = useState(false);
  const groupId = useId();
  switch (field.kind) {
    case "boolean":
      return (
        <label className="switch">
          <input id={id} type="checkbox" role="switch" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-text">{value === true ? "Yes" : "No"}</span>
        </label>
      );
    case "select":
      if (field.options.length <= 4) {
        return (
          <div className="segmented cap-text" role="radiogroup" aria-labelledby={`${id}-label`}>
            {field.options.map((o) => (
              <label key={o} className={value === o ? "on" : ""}>
                <input type="radio" name={groupId} value={o} checked={value === o} onChange={() => onChange(o)} />
                {o}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select id={id} className="inline-input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "datetime": {
      const now = new Date();
      const inHour = new Date(now.getTime() + 3600_000);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
      const presets = [
        { label: "Now", value: "" },
        { label: "In 1 hour", value: localInput(inHour) },
        { label: "Tomorrow 09:00", value: localInput(tomorrow) },
      ];
      const custom = value !== "" && !presets.some((p) => p.value === value);
      return (
        <div className="datetime">
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
            {presets.map((p) => (
              <label key={p.label} className={value === p.value ? "on" : ""}>
                <input type="radio" name={groupId} checked={value === p.value} onChange={() => onChange(p.value)} />
                {p.label}
              </label>
            ))}
            <label className={custom ? "on" : ""}>
              <input type="radio" name={groupId} checked={custom} onChange={() => onChange(localInput(new Date(tomorrow.getTime() + 3600_000)))} />
              Pick…
            </label>
          </div>
          {value !== "" && (
            <input id={id} type="datetime-local" className="inline-input when" value={String(value)} onChange={(e) => onChange(e.target.value)} />
          )}
        </div>
      );
    }
    case "textarea":
      return (
        <div className="md-editor">
          {previewing ? (
            <div className="md-preview">{String(value).trim() ? <Markdown source={String(value)} /> : <span className="muted">Nothing to preview</span>}</div>
          ) : (
            <textarea id={id} className="inline-input" rows={4} value={String(value)} placeholder="Write in markdown" onChange={(e) => onChange(e.target.value)} />
          )}
          <button type="button" className="md-toggle" onClick={() => setPreviewing((p) => !p)}>
            {previewing ? "Edit" : "Preview"}
          </button>
        </div>
      );
    case "list":
      return <textarea id={id} className="inline-input list" rows={3} value={String(value)} placeholder="One per line" onChange={(e) => onChange(e.target.value)} />;
    case "json":
      return <textarea id={id} className="inline-input json" rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
    case "text":
    case "number":
    case "integer":
      return (
        <input
          id={id}
          className={`inline-input ${field.kind !== "text" ? "num" : ""}`}
          inputMode={field.kind === "text" ? undefined : "decimal"}
          value={String(value)}
          placeholder={field.required ? "Required" : "Optional"}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export const schemaType = (field: Field) =>
  ({ text: "string", textarea: "string", number: "number", integer: "integer", boolean: "boolean", select: "enum", list: "string[]", json: "object", datetime: "date-time" })[field.kind];

export { hostOf };
