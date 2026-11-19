// Write cards (inside the review dock) and the Publish ledger they leave in the document.
// A write never runs from Mosaic's page: its one button asks the site, and the site's own
// approval sheet is the only place the person can approve it.
import { ArrowUpRightIcon, CheckIcon, HourglassMediumIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import { capAnchor, hostOf, type Binding, type CapRef } from "../doc";
import { fmtTime } from "../format";
import { Button, Monogram, Provenance, Tag, Token, useHueStyle } from "../primitives";
import { InputFields } from "../runbook";
import { inputKeys, useMosaic } from "../state";
import { resultLinks, writeStatus, type WriteStatus } from "./status";
import { openReview } from "./ui";

const STATUS_TAG: Partial<Record<WriteStatus, { tone: "warning" | "success" | "danger"; text: string }>> = {
  waiting: { tone: "warning", text: "Waiting for you" },
  done: { tone: "success", text: "Published" },
  denied: { tone: "danger", text: "Denied" },
  failed: { tone: "danger", text: "Failed" },
};

/** One pending write: what it changes, its inputs, and the button that asks the site. */
export function WriteCard({ r, index, offPlan }: { r: CapRef; index?: number; offPlan?: boolean }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key] ?? { status: "idle" };
  const status = writeStatus(state, r);
  const host = hostOf(r.origin);
  const reason = !model.readyOf(r.origin)
    ? `Waiting for ${host} to answer`
    : status === "waiting"
      ? `Answer the prompt from ${host} first`
      : status === "running"
        ? "Sending now"
        : state.confirming
          ? `Answer the prompt from ${hostOf(state.confirming)} first`
          : null;
  const tag = STATUS_TAG[status];
  return (
    <article className={`wcard cap ${status} ${offPlan ? "off-plan" : ""}`} data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)} style={hue(r.origin)}>
      <header className="wcard-head">
        <span className="wcard-num" aria-hidden="true">
          {status === "done" ? <CheckIcon weight="bold" /> : status === "denied" || status === "failed" ? <ProhibitIcon weight="bold" /> : (index ?? "·")}
        </span>
        <h3>{r.cap.title}</h3>
        {tag && (
          <Tag tone={tag.tone} size="sm">
            {tag.text}
          </Tag>
        )}
        <Provenance name={r.siteName} origin={r.origin} />
      </header>
      {status !== "done" && (
        <div className="wcard-body">
          <InputFields r={r} compact />
        </div>
      )}
      {status === "done" && run.status === "done" ? (
        <div className="output wcard-receipt">
          <CheckIcon weight="bold" aria-hidden="true" />
          <span>
            Published on <b>{host}</b> at {fmtTime(run.at)}
          </span>
          {resultLinks(run.output, r.origin).map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className="wcard-link">
              {l.path}
              <ArrowUpRightIcon aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : (
        <footer className="wcard-foot">
          <Button variant="secondary" size="sm" icon={status === "waiting" ? <HourglassMediumIcon /> : undefined} onClick={() => void actions.run(r)} disabledReason={reason}>
            {status === "denied" || status === "failed" ? `Ask ${host} again` : `Approve on ${host}`}
          </Button>
          <span className="hint">{status === "waiting" ? `${r.siteName} is showing its prompt now.` : `Opens ${r.siteName}'s own prompt. Nothing changes until you approve there.`}</span>
        </footer>
      )}
      {run.status === "error" && (
        <p className={`wcard-error output-error ${run.denied ? "denied" : ""}`}>
          {run.denied ? <ProhibitIcon aria-hidden="true" /> : <WarningIcon aria-hidden="true" />}
          <span>{run.denied ? `Denied on ${host}. Nothing changed.` : `${host} said: ${run.message}`}</span>
        </p>
      )}
    </article>
  );
}

/**
 * The document's last section: one ticket per write, in step order. A pending ticket names where
 * its values come from (and carries the data-flow-dst anchors the runbook's wires end on); an
 * answered one is the receipt, with the result's link. Clicking a ticket opens it in the dock.
 */
export function PublishSection() {
  const { state, model } = useMosaic();
  const writes = model.writes;
  if (writes.length === 0) return null;
  const published = writes.filter((r) => state.runs[r.key]?.status === "done").length;
  return (
    <section className="ledger" id="receipts" aria-label="Publish">
      <header className="ledger-head">
        <h2>Publish</h2>
        <span className="ledger-count">
          {published === writes.length ? `All ${writes.length} published` : `${published} of ${writes.length} published`}
        </span>
      </header>
      <ol className="ledger-list">
        {writes.map((r) => (
          <Ticket key={r.key} r={r} />
        ))}
      </ol>
    </section>
  );
}

function Ticket({ r }: { r: CapRef }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key] ?? { status: "idle" };
  const status = writeStatus(state, r);
  const host = hostOf(r.origin);
  const links = run.status === "done" ? resultLinks(run.output, r.origin) : [];
  const sources = inputKeys(r)
    .map((f) => model.bindingFor(r.key, f))
    .filter((b): b is Extract<Binding, { kind: "output" }> => b?.kind === "output");
  const answered = status === "done" || status === "denied" || status === "failed";
  return (
    <li className={`stub ${status}`} style={hue(r.origin)}>
      {sources.map((b, i) => (
        <span key={i} className="stub-dst" data-flow-dst={`${b.cap}|${b.field}`} style={{ top: `calc(50% + ${(i - (sources.length - 1) / 2) * 8}px)` }} aria-hidden="true" />
      ))}
      <button type="button" className="stub-main" onClick={() => openReview(r.key)} aria-label={`${r.cap.title} on ${host}: open in review`}>
        <Monogram name={r.siteName} origin={r.origin} />
        <span className="stub-text">
          <span className="stub-title">{r.cap.title}</span>
          <span className="stub-sub">
            {(run.status === "done" || run.status === "error") ? (
              <>
                {status === "done" ? "Approved" : status === "denied" ? "Denied" : "Failed"} on <b>{host}</b> · <time>{fmtTime(run.at)}</time>
              </>
            ) : status === "waiting" ? (
              <>Waiting for your answer on {host}</>
            ) : sources.length > 0 ? (
              <span className="stub-from">
                <span className="stub-from-label">from</span>
                {sources.map((b, i) => (
                  <Token key={i} info={model.tokenInfo(b)} onHover={(on) => actions.setHot(on ? b.cap : null)} />
                ))}
              </span>
            ) : (
              <>Changes {host}</>
            )}
          </span>
        </span>
      </button>
      <span className="stub-tear" aria-hidden="true" />
      <span className="stub-side">
        {status === "done" ? (
          links.length > 0 ? (
            links.map((l) => (
              <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className="stub-link">
                {l.path}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            ))
          ) : (
            <span className="stub-note">Done</span>
          )
        ) : status === "waiting" || status === "running" ? (
          <Tag tone="warning" size="sm">
            {status === "waiting" ? "Waiting for you" : "Sending"}
          </Tag>
        ) : (
          <button type="button" className="link-btn stub-review" onClick={() => openReview(r.key)}>
            {answered ? "Nothing changed · Review" : "Review"}
          </button>
        )}
        <span className="stub-stamp" aria-hidden="true">
          {status === "done" ? <CheckIcon weight="bold" /> : answered ? <ProhibitIcon weight="bold" /> : null}
        </span>
      </span>
    </li>
  );
}
