// Output as content: markdown rendered as a page, a before/after pair as a word-level diff, record
// lists as tables, everything else as labelled facts. Shapes, not site names, decide the view, so
// an unknown site's output renders the same way.
import { diffArrays, diffLines as jsDiffLines } from "diff";
import { useState, type ReactNode } from "react";
import { looksLikeMarkdown, parseInline, parseMarkdown, preview } from "../doc";
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

/** Human words for a field key: "published_at" → "Published at". */
export const humanKey = (k: string) => {
  const s = k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])(?![A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`).trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : k;
};

// ── Diff ────────────────────────────────────────────────────────────────────

type Seg = { text: string; mark: boolean };
type Row = { op: " " | "+" | "-"; segs: Seg[]; oldNo?: number; newNo?: number };
type Item = { kind: "row"; row: Row } | { kind: "fold"; rows: Row[] };

const plain = (text: string): Seg[] => [{ text, mark: false }];
const lines = (value: string) => {
  const ls = value.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
};

/** Word diff over whitespace-separated tokens, so "0.9" and "v1.0" stay whole words. */
function wordDiff(a: string, b: string): { value: string; added?: boolean; removed?: boolean }[] {
  return diffArrays(a.split(/(\s+)/).filter(Boolean), b.split(/(\s+)/).filter(Boolean)).map((c) => ({ value: c.value.join(""), added: c.added, removed: c.removed }));
}

/** Line diff from jsdiff, then word-level marks inside each changed line pair. */
export function diffRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let o = 1;
  let n = 1;
  const parts = jsDiffLines(before.endsWith("\n") ? before : before + "\n", after.endsWith("\n") ? after : after + "\n");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p.added && !p.removed) {
      for (const l of lines(p.value)) rows.push({ op: " ", segs: plain(l), oldNo: o++, newNo: n++ });
      continue;
    }
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      const del = lines(p.value);
      const add = lines(next.value);
      const pairs = Math.min(del.length, add.length);
      const delRows: Row[] = [];
      const addRows: Row[] = [];
      for (let j = 0; j < Math.max(del.length, add.length); j++) {
        if (j < pairs) {
          const words = wordDiff(del[j]!, add[j]!);
          const similar = words.filter((w) => !w.added && !w.removed).reduce((s, w) => s + w.value.length, 0) > Math.min(del[j]!.length, add[j]!.length) * 0.35;
          delRows.push({ op: "-", oldNo: o++, segs: similar ? words.filter((w) => !w.added).map((w) => ({ text: w.value, mark: !!w.removed })) : plain(del[j]!) });
          addRows.push({ op: "+", newNo: n++, segs: similar ? words.filter((w) => !w.removed).map((w) => ({ text: w.value, mark: !!w.added })) : plain(add[j]!) });
        } else if (j < del.length) delRows.push({ op: "-", oldNo: o++, segs: plain(del[j]!) });
        else addRows.push({ op: "+", newNo: n++, segs: plain(add[j]!) });
      }
      rows.push(...delRows, ...addRows);
      i++;
      continue;
    }
    for (const l of lines(p.value)) rows.push(p.added ? { op: "+", segs: plain(l), newNo: n++ } : { op: "-", segs: plain(l), oldNo: o++ });
  }
  return rows;
}

/** Fold runs of unchanged lines longer than `keep * 2 + 1`, keeping `keep` lines of context each side. */
function fold(rows: Row[], keep = 1): Item[] {
  const out: Item[] = [];
  let run: Row[] = [];
  const flush = (end: boolean) => {
    const start = out.length === 0;
    const head = start ? 0 : keep;
    const tail = end ? 0 : keep;
    if (run.length > head + tail + 1) {
      run.slice(0, head).forEach((row) => out.push({ kind: "row", row }));
      out.push({ kind: "fold", rows: run.slice(head, run.length - tail) });
      run.slice(run.length - tail).forEach((row) => out.push({ kind: "row", row }));
    } else run.forEach((row) => out.push({ kind: "row", row }));
    run = [];
  };
  for (const row of rows) {
    if (row.op === " ") run.push(row);
    else {
      flush(false);
      out.push({ kind: "row", row });
    }
  }
  flush(true);
  return out;
}

function DiffRow({ row }: { row: Row }) {
  return (
    <div className={`dl ${row.op === "+" ? "add" : row.op === "-" ? "del" : ""}`} role="row">
      <span className="dl-no" aria-hidden="true">
        {row.op === "+" ? "" : row.oldNo}
      </span>
      <span className="dl-no" aria-hidden="true">
        {row.op === "-" ? "" : row.newNo}
      </span>
      <span className="dl-op" aria-hidden="true">
        {row.op === " " ? "" : row.op === "+" ? "+" : "−"}
      </span>
      <span className="dl-text" role="cell">
        {row.segs.length === 0 || row.segs.every((s) => !s.text) ? " " : row.segs.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
      </span>
    </div>
  );
}

function Fold({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  if (open) return rows.map((row, i) => <DiffRow key={i} row={row} />);
  return (
    <button type="button" className="dl-fold" onClick={() => setOpen(true)}>
      <span aria-hidden="true">⋯</span> {rows.length} unchanged line{rows.length === 1 ? "" : "s"}
    </button>
  );
}

/** A proposed change: word-marked diff, or the result as a rendered page. */
export function Diff({ path, before, after }: { path?: string; before: string; after: string }) {
  const [view, setView] = useState<"changes" | "result">("changes");
  const rows = diffRows(before, after);
  const added = rows.filter((l) => l.op === "+").length;
  const removed = rows.filter((l) => l.op === "-").length;
  return (
    <figure className="diff out-section">
      <figcaption>
        <span className="diff-path">{path ?? "Change"}</span>
        <span className="diff-stat" aria-label={`${added} lines added, ${removed} removed`}>
          <span className="add">+{added}</span>
          <span className="del">−{removed}</span>
          <span className="diff-bar" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => {
              const total = added + removed || 1;
              const greens = Math.round((added / total) * 5);
              return <i key={i} className={i < greens ? "add" : "del"} />;
            })}
          </span>
        </span>
        <span className="mini-seg" role="radiogroup" aria-label="Diff view">
          {(["changes", "result"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {v === "changes" ? "Changes" : "Result"}
            </button>
          ))}
        </span>
      </figcaption>
      {view === "changes" ? (
        <div className="diff-body" role="table" aria-label="Proposed change">
          {fold(rows).map((it, i) => (it.kind === "row" ? <DiffRow key={i} row={it.row} /> : <Fold key={i} rows={it.rows} />))}
        </div>
      ) : (
        <div className="diff-result">
          <Markdown source={after} />
        </div>
      )}
    </figure>
  );
}

// ── Values, records and the whole output ────────────────────────────────────

function Scalar({ value, origin, k }: { value: unknown; origin: string; k: string }) {
  if (isIsoDate(value)) return <time dateTime={value}>{fmtDate(value)}</time>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="out-section page">
      <header className="out-label">{humanKey(label)}</header>
      {children}
    </section>
  );
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
        <Section key={k} label={k}>
          <Markdown source={v} />
        </Section>,
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
      <dl className="facts" key="meta">
        {rest.map(([k, v]) => (
          <div key={k}>
            <dt>{humanKey(k)}</dt>
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

const MAX_ROWS = 6;

function cell(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (isIsoDate(v)) return fmtDate(v);
  return preview(String(typeof v === "object" ? JSON.stringify(v) : v), 48);
}

export function RecordTable({ rows, origin, caption }: { rows: unknown[]; origin: string; caption?: string }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="out-empty">No {caption ? humanKey(caption).toLowerCase() : "items"} yet.</p>;
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
  const shown = all ? records : records.slice(0, MAX_ROWS);
  return (
    <div className="records-wrap out-section">
      <table className="records">
        {caption && (
          <caption>
            {humanKey(caption)} <span className="count">{rows.length}</span>
          </caption>
        )}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {humanKey(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {cols.map((c, j) => (
                <td key={c} className={j === 0 ? "lead" : ""}>
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > MAX_ROWS && (
        <button type="button" className="link-btn records-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${records.length}`}
        </button>
      )}
    </div>
  );
}

/** One-line summary of a context read's output ("1 release · latest v0.9.0"). */
export function summarize(output: unknown): string {
  if (output && typeof output === "object") {
    const entry = Object.entries(output).find(([, v]) => Array.isArray(v)) as [string, unknown[]] | undefined;
    if (entry) {
      const [k, arr] = entry;
      const first = arr[0] as Record<string, unknown> | undefined;
      const label = first && typeof first === "object" ? Object.values(first).find((v) => typeof v === "string" && !isIsoDate(v)) : undefined;
      const noun = arr.length === 1 ? humanKey(k).toLowerCase().replace(/s$/, "") : humanKey(k).toLowerCase();
      return `${arr.length} ${noun}${label ? ` · latest ${preview(String(label), 24)}` : ""}`;
    }
  }
  return preview(typeof output === "string" ? output : JSON.stringify(output), 60);
}
