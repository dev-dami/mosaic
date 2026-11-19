// Output as content: markdown rendered, a before/after pair as a diff, record lists as tables.
// Shapes, not site names, decide the view.
import { useState, type ReactNode } from "react";
import { diffLines, looksLikeMarkdown, parseInline, parseMarkdown, preview } from "../doc";
import { fmtDate, isIsoDate } from "../format";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.t === "code" ? <code key={i}>{part.text}</code> : part.t === "strong" ? <strong key={i}>{part.text}</strong> : part.t === "em" ? <em key={i}>{part.text}</em> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

/** A small, safe markdown subset rendered to elements (never to an HTML string). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={`md ${className ?? ""}`}>
      {parseMarkdown(source).map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = `h${Math.min(b.level + 2, 6)}` as "h3";
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

/** Show a capability's result as content. */
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

/** One-line summary of a context read's output ("3 items · latest v0.9.0"). */
export function summarize(output: unknown): string {
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

/** The exact output, behind a disclosure. Rendered only when open, so it never competes with the content view. */
export function RawOutput({ value }: { value: unknown }) {
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
