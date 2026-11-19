// A step: one site's part of the runbook, with its context reads, its reads that take input,
// and a line pointing to its writes (which the review area shows).
import { PlayIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { compileForm } from "../../form";
import { capAnchor, hostOf, outputFields, type CapRef } from "../doc";
import { Button, Monogram, Provenance, useHueStyle } from "../primitives";
import { hasInputs, useMosaic, type Run } from "../state";
import { InputFields, SummaryItem } from "./fields";
import { OutputView, RawOutput, summarize } from "./output";

export function Step({ origin, number }: { origin: string; number: number }) {
  const { state, model } = useMosaic();
  const hue = useHueStyle();
  const conn = model.connFor(origin)!;
  const fresh = state.fresh.includes(origin);
  const mine = model.refs.filter((r) => r.origin === origin && !model.hidden.has(r.key));
  const context = mine.filter((r) => r.cap.side_effects === "read" && !hasInputs(r));
  const reads = mine.filter((r) => r.cap.side_effects === "read" && hasInputs(r));
  const writes = mine.filter((r) => r.cap.side_effects === "write");
  const lead = reads[0];
  const states = reads.map((r) => state.runs[r.key]?.status ?? "idle");
  const status = states.includes("running") ? "running" : states.includes("error") ? "error" : states.length && states.every((s) => s === "done") ? "done" : "idle";
  const publishNumber = model.siteOrder.length + 1;
  return (
    <section className={`step ${fresh ? "fresh" : ""}`} data-origin={origin} style={hue(origin)} aria-labelledby={`step-${number}`}>
      <div className="step-gutter">
        <span className={`step-num ${status}`}>{status === "done" ? <span aria-label={`Step ${number} done`}>✓</span> : number}</span>
      </div>
      <header className="step-head">
        <h2 id={`step-${number}`}>{lead?.cap.title ?? conn.site.site.name}</h2>
        <Provenance name={conn.site.site.name} origin={origin} />
        {fresh && <span className="new-pill">New · built from its manifest</span>}
      </header>
      <div className="step-gap" />
      {conn.status === "failed" && <p className="block-error">This site refused Mosaic: {conn.failure}</p>}

      {context.map((r) => (
        <ContextLine key={r.key} r={r} run={state.runs[r.key]} />
      ))}
      {reads.map((r, i) => (
        <ReadBlock key={r.key} r={r} showTitle={i > 0} />
      ))}
      {reads.length === 0 && writes.length > 0 && <p className="step-note">This site only offers changes. They are listed under Ready to publish.</p>}
      {writes.length > 0 && (
        <p className="then">
          <span className="diamond" aria-hidden="true" />
          Then {writes.map((w) => w.cap.title.toLowerCase()).join(" and ")}, in step {publishNumber} after your approval on {hostOf(origin)}.
        </p>
      )}
    </section>
  );
}

/** A read that needs no input: run at once, kept to one line, expandable. */
function ContextLine({ r, run }: { r: CapRef; run?: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="context cap" data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)}>
      <button type="button" className="context-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ctx-title">{r.cap.title}</span>
        <span className="ctx-sum">{run?.status === "done" ? summarize(run.output) : run?.status === "error" ? run.message : run?.status === "running" ? "Reading…" : "Not read yet"}</span>
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

/** A read that takes input: its fields, its run button, then its output as content. */
function ReadBlock({ r, showTitle }: { r: CapRef; showTitle: boolean }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const run = state.runs[r.key] ?? { status: "idle" };
  const ready = model.readyOf(r.origin);
  const host = hostOf(r.origin);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const doneAt = run.status === "done" ? run.at.getTime() : 0;
  // Once a block has run, its inputs fold into one sentence and its output becomes the content.
  useEffect(() => setEditing(false), [doneAt]);
  const collapsed = run.status === "done" && !editing;
  const outs = outputFields(r.cap);
  const usedBy = model.usedBy(r.key);
  const notReady = ready ? null : `Waiting for ${host} to answer`;
  return (
    <article className={`block cap ${state.hot === r.key ? "hot" : ""} ${run.status}`} data-capability={r.cap.id} data-origin={r.origin} data-flow-anchor={r.key} id={capAnchor(r.key)}>
      {showTitle && <h3 className="block-title">{r.cap.title}</h3>}
      <p className="block-desc">{r.cap.description}</p>
      {collapsed ? (
        <div className="inputs-summary">
          {fields.map((f) => (
            <SummaryItem key={f.key} r={r} field={f} />
          ))}
          <span className="sum-actions">
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit inputs
            </button>
            <button type="button" className="link-btn" onClick={() => void actions.run(r)} disabled={!ready}>
              Run again
            </button>
          </span>
        </div>
      ) : (
        <>
          <InputFields r={r} />
          <div className="block-actions">
            <Button variant="primary" icon={<PlayIcon weight="fill" />} onClick={() => void actions.run(r)} disabledReason={notReady ?? (run.status === "running" ? "Running now" : null)}>
              {run.status === "running" ? "Running…" : r.cap.title}
            </Button>
            <span className="hint">Read only · nothing changes on {host}</span>
            <button type="button" className="link-btn push" onClick={() => setSchemaOpen((s) => !s)} aria-expanded={schemaOpen}>
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
                return (
                  <span key={f} className={`out-token ${model.isOutputUsed(r.key, f) ? "used" : ""}`} data-flow-src={`${r.key}|${f}`} style={hue(r.origin)}>
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
