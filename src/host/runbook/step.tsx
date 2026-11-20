// A step: one site's part of the runbook. A sticky header (number key, title, a tag counting the
// site's changes waiting in the review bar, the site chip), then each read that takes input as a
// block. Reads that need no input are context: they run on their own and show in the site chip's
// details. Writes live only in the review bar and drawer; the header tag links there.
//
// A read block puts the inputs in one sentence of chips and the Run button on the same line. Only
// the fields that still need the person open as rows; "Edit" opens all of them. Once it runs, the
// output is the content of the block, and the "feeds" row says which later steps take it.
import { ArrowClockwiseIcon, ArrowRightIcon, CheckIcon, PaperPlaneTiltIcon, PlayIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { compileForm } from "../../form";
import { capAnchor, outputFields, type CapRef } from "../doc";
import { Banner, Button, Monogram, useHueStyle } from "../primitives";
import { hasInputs, useMosaic } from "../state";
import { AgentTag } from "../agent";
import { SiteDetails } from "./details";
import { fieldId, InputFields, InputSentence, needsPerson } from "./fields";
import { flowHandlers } from "./flow";
import { OutputView } from "./output";

const two = (n: number) => String(n).padStart(2, "0");

type StepStatus = "idle" | "running" | "done" | "error";

export function Step({ origin, number }: { origin: string; number: number }) {
  const { state, model } = useMosaic();
  const hue = useHueStyle();
  const conn = model.connFor(origin)!;
  const fresh = state.fresh.includes(origin);
  const all = model.refs.filter((r) => r.origin === origin);
  const mine = all.filter((r) => !model.hidden.has(r.key));
  const hiddenReads = all.filter((r) => model.hidden.has(r.key) && r.cap.side_effects === "read");
  const context = mine.filter((r) => r.cap.side_effects === "read" && !hasInputs(r));
  const reads = mine.filter((r) => r.cap.side_effects === "read" && hasInputs(r));
  const writes = mine.filter((r) => r.cap.side_effects === "write");
  const lead = reads[0] ?? context[0];
  const states = reads.map((r) => state.runs[r.key]?.status ?? "idle");
  const status: StepStatus = states.includes("running") ? "running" : states.includes("error") ? "error" : states.length && states.every((s) => s === "done") ? "done" : "idle";
  const name = conn.site.site.name;
  const pendingWrites = writes.filter((w) => state.runs[w.key]?.status !== "done");
  return (
    <m.section
      layout="position"
      transition={{ layout: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] } }}
      className={`step ${status} ${fresh ? "fresh" : ""}`}
      data-origin={origin}
      style={hue(origin)}
      aria-labelledby={`step-${number}`}
    >
      <header className="step-head">
        <span className={`step-key ${status}`} aria-label={`Step ${number}${status === "done" ? ", done" : status === "running" ? ", running" : status === "error" ? ", failed" : ""}`}>
          {two(number)}
          {status === "done" && (
            <span className="step-key-badge" aria-hidden="true">
              <CheckIcon size={9} weight="bold" />
            </span>
          )}
        </span>
        <h2 id={`step-${number}`}>{lead?.cap.title ?? name}</h2>
        <AgentTag site={conn.site} compact />
        {fresh && <span className="new-pill">New</span>}
        {writes.length > 0 && (
          <a href={`#${capAnchor((pendingWrites[0] ?? writes[0]!).key)}`} className={`step-pub ${pendingWrites.length ? "" : "done"}`} title={`In the review bar: ${writes.map((w) => w.cap.title).join(", ")}`}>
            {pendingWrites.length ? <PaperPlaneTiltIcon aria-hidden="true" /> : <CheckIcon weight="bold" aria-hidden="true" />}
            {pendingWrites.length ? (
              <>
                {pendingWrites.length}
                <span className="step-pub-text"> {pendingWrites.length === 1 ? "change" : "changes"} to publish</span>
              </>
            ) : (
              <span className="step-pub-text">{writes.length === 1 ? "Published" : "All published"}</span>
            )}
          </a>
        )}
        <SiteDetails origin={origin} name={name} refs={all} context={context} />
      </header>
      {lead && <p className="step-desc">{lead.cap.description}</p>}

      {/* Context reads show in the site chip's details; each keeps its one element here. */}
      {context.map((r) => (
        <span key={r.key} hidden className="cap cap--context" data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)} />
      ))}
      {reads.map((r, i) => (
        <ReadBlock key={r.key} r={r} showTitle={i > 0} />
      ))}
      {reads.length === 0 && writes.length > 0 && <p className="step-note">{name} only offers changes. They wait in the review bar until you approve them on {name}'s own prompt.</p>}
      {hiddenReads.length > 0 && (
        <p className="step-hidden">
          Not needed for this outcome:{" "}
          {hiddenReads.map((r, i) => (
            <span key={r.key} className="cap cap--hidden" data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)}>
              {r.cap.title}
              {i < hiddenReads.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
    </m.section>
  );
}

/** A read that takes input: a sentence of inputs and Run, the fields that need the person, then the output. */
function ReadBlock({ r, showTitle }: { r: CapRef; showTitle: boolean }) {
  const { state, model, actions } = useMosaic();
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const run = state.runs[r.key] ?? { status: "idle" };
  const ready = model.readyOf(r.origin);
  const [editing, setEditing] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const blockRef = useRef<HTMLElement>(null);

  // Fields that still need the person open as rows, and stay open while they type (so a row does
  // not jump into the sentence after the first key). Binding a field closes its row.
  const needing = fields.filter((f) => needsPerson(f, model.bindingFor(r.key, f.key), state.manual[r.key]?.[f.key] ?? f.initial)).map((f) => f.key);
  const [kept, setKept] = useState<string[]>(needing);
  const needKey = needing.join("|");
  useEffect(() => {
    setKept((k) => [...new Set([...k, ...needing])].filter((key) => !model.bindingFor(r.key, key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey, model]);
  const doneAt = run.status === "done" ? run.at.getTime() : 0;
  useEffect(() => {
    if (!doneAt) return;
    setEditing(false);
    setKept([]);
  }, [doneAt]);
  const open = new Set(editing ? fields.map((f) => f.key) : kept);
  const openKeys = fields.filter((f) => open.has(f.key)).map((f) => f.key);

  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(fieldId(r, focusField)) ?? blockRef.current?.querySelector<HTMLElement>(`[aria-labelledby="${fieldId(r, focusField)}-label"] input`);
    el?.focus();
    setFocusField(null);
  }, [focusField, r]);

  const reason = !ready ? `Waiting for ${r.siteName} to answer` : run.status === "running" ? "Running now" : null;
  const go = () => {
    if (!reason) void actions.run(r);
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !e.shiftKey && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "radio" && (t as HTMLInputElement).type !== "checkbox") {
      e.preventDefault();
      go();
    }
  };
  const done = run.status === "done";
  // One chunky primary at a time: only the next read still to run gets it.
  const next = model.siteOrder.flatMap((o) => model.reads.filter((x) => x.origin === o)).find((x) => state.runs[x.key]?.status !== "done");
  const isNext = next?.key === r.key;
  return (
    <article
      ref={blockRef}
      className={`block cap ${state.hot === r.key ? "hot" : ""} ${run.status} ${openKeys.length ? "has-open" : ""} ${isNext ? "next" : ""}`}
      data-capability={r.cap.id}
      data-origin={r.origin}
      data-flow-anchor={r.key}
      id={capAnchor(r.key)}
      onKeyDown={onKey}
    >
      {showTitle && (
        <header className="block-head">
          <h3 className="block-title">{r.cap.title}</h3>
          <p className="block-desc">{r.cap.description}</p>
        </header>
      )}
      <div className="block-bar">
        <InputSentence
          r={r}
          open={open}
          onEdit={(f) => {
            setEditing(true);
            setFocusField(f ?? fields[0]?.key ?? null);
          }}
        />
        <div className="block-run">
          {done ? (
            <>
              <span className="ran-at">Ran {run.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
              <Button variant="tertiary" size="xs" className="run-again" icon={<ArrowClockwiseIcon />} onClick={go} disabledReason={reason} aria-label={`Run ${r.cap.title} again`}>
                Run again
              </Button>
            </>
          ) : (
            <Button
              variant={isNext ? "primary" : "secondary"}
              icon={run.status === "running" ? <span className="spinner" aria-hidden="true" /> : <PlayIcon weight="fill" />}
              onClick={go}
              disabledReason={reason}
              aria-label={`Run ${r.cap.title}`}
            >
              {run.status === "running" ? "Running" : "Run"}
            </Button>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {openKeys.length > 0 && (
          <m.div key="fields" className="block-fields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
            <InputFields r={r} only={openKeys} />
            {editing && (
              <div className="fields-foot">
                <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                  Done editing
                </button>
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
      {run.status === "error" && (
        <Banner tone="danger" icon={<WarningIcon />} className="block-error output-error">
          {run.message}
        </Banner>
      )}
      {done ? (
        <m.div className="output" key={doneAt} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
          <OutputView value={run.output} origin={r.origin} />
          <Feeds r={r} output={run.output} />
        </m.div>
      ) : (
        run.status !== "error" && <Placeholder r={r} running={run.status === "running"} slim={openKeys.length > 0} />
      )}
    </article>
  );
}

/** Before the first run: what will appear, and that nothing changes on the site. */
function Placeholder({ r, running, slim }: { r: CapRef; running: boolean; slim: boolean }) {
  const outs = outputFields(r.cap);
  return (
    <div className={`placeholder ${running ? "running" : ""} ${slim ? "slim" : ""}`}>
      <span>{running ? `Reading from ${r.siteName}…` : outs.length ? `Run to see ${outs.join(", ")}.` : "Run to see the result."}</span>
      <span className="ph-safe">Read only. Nothing changes on {r.siteName}.</span>
    </div>
  );
}

/** Each output field as a token, and the later steps that take it. */
function Feeds({ r, output }: { r: CapRef; output: unknown }) {
  const { model, actions } = useMosaic();
  const hue = useHueStyle();
  const outs = outputFields(r.cap).filter((f) => (output as Record<string, unknown> | null)?.[f] !== undefined);
  if (outs.length === 0) return null;
  const takers = (field: string) =>
    model.refs.filter((o) => o.key !== r.key && Object.keys(o.cap.input_schema.properties ?? {}).some((k) => {
      const b = model.bindingFor(o.key, k);
      return b?.kind === "output" && b.cap === r.key && b.field === field;
    }));
  const token = (f: string, used: boolean) => (
    <span key={f} className={`out-token ${used ? "used" : ""}`} data-flow-src={`${r.key}|${f}`} style={hue(r.origin)} tabIndex={used ? 0 : undefined} {...flowHandlers({ src: r.key, field: f }, (on) => actions.setHot(on ? r.key : null))}>
      <Monogram name={r.siteName} origin={r.origin} size="sm" />
      {f}
    </span>
  );
  const used = outs.map((f) => ({ f, ts: takers(f) })).filter((x) => x.ts.length > 0);
  const unused = outs.filter((f) => !used.some((u) => u.f === f));
  return (
    <div className="feeds">
      {used.map(({ f, ts }) => (
        <div className="feed" key={f}>
          {token(f, true)}
          <ArrowRightIcon size={13} className="feed-arrow" aria-hidden="true" />
          <span className="feed-label">feeds</span>
          {ts.map((t) => {
            const n = model.stepOf.get(t.origin);
            return (
              <a key={t.key} className="feed-target" href={`#${capAnchor(t.key)}`} style={hue(t.origin)} {...flowHandlers({ src: r.key, field: f, dst: t.key })}>
                {t.cap.side_effects === "read" && n ? <span className="ft-num">{two(n)}</span> : <Monogram name={t.siteName} origin={t.origin} size="sm" />}
                {t.cap.title}
              </a>
            );
          })}
        </div>
      ))}
      {unused.length > 0 && (
        <div className="feed quiet">
          <span className="feed-label">{used.length ? "Also returns" : "Returns"}</span>
          {unused.map((f) => token(f, false))}
          {used.length === 0 && <span className="feed-label">· no later step takes {unused.length === 1 ? "it" : "these"} yet</span>}
        </div>
      )}
    </div>
  );
}
