// Write cards (inside the review dock) and the receipts they leave in the document.
// A write never runs from Mosaic's page: its one button asks the site, and the site's own
// approval sheet is the only place the person can approve it.
import { ArrowUpRightIcon, CheckIcon, HourglassMediumIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import { capAnchor, hostOf, type CapRef } from "../doc";
import { fmtTime } from "../format";
import { Button, Monogram, Provenance, Tag, useHueStyle } from "../primitives";
import { InputFields } from "../runbook";
import { useMosaic } from "../state";
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
 * Receipts, in the document: one stub per write that has an answer (published or denied). Pending
 * writes live in the review dock, not here, so the document ends with what actually happened.
 */
export function PublishSection() {
  const { state, model } = useMosaic();
  const answered = model.refs.filter((r) => r.cap.side_effects === "write" && ["done", "denied", "failed"].includes(writeStatus(state, r)));
  if (answered.length === 0) return null;
  const published = answered.filter((r) => state.runs[r.key]?.status === "done").length;
  return (
    <section className="receipts" id="receipts" aria-label="Receipts">
      <header className="receipts-head">
        <h2 className="label">Receipts</h2>
        <span className="receipts-count">
          {published} of {model.writes.length} published
        </span>
      </header>
      <ol className="receipts-list">
        {answered.map((r) => (
          <ReceiptStub key={r.key} r={r} />
        ))}
      </ol>
    </section>
  );
}

function ReceiptStub({ r }: { r: CapRef }) {
  const { state } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key];
  if (!run || (run.status !== "done" && run.status !== "error")) return null;
  const ok = run.status === "done";
  const host = hostOf(r.origin);
  const links = ok ? resultLinks(run.output, r.origin) : [];
  return (
    <li className={`stub ${ok ? "ok" : "no"}`} style={hue(r.origin)}>
      <div className="stub-main">
        <Monogram name={r.siteName} origin={r.origin} />
        <div className="stub-text">
          <span className="stub-title">{r.cap.title}</span>
          <span className="stub-sub">
            {ok ? "Approved" : run.denied ? "Denied" : "Failed"} on <b>{host}</b> · <time>{fmtTime(run.at)}</time>
          </span>
        </div>
      </div>
      <div className="stub-tear" aria-hidden="true" />
      <div className="stub-side">
        {ok ? (
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
        ) : (
          <button type="button" className="stub-note link-btn" onClick={() => openReview(r.key)}>
            {run.denied ? "Nothing changed. Review again" : "Review again"}
          </button>
        )}
        <span className="stub-stamp" aria-hidden="true">
          {ok ? <CheckIcon weight="bold" /> : <ProhibitIcon weight="bold" />}
        </span>
      </div>
    </li>
  );
}
