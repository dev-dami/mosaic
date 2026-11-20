// Write cards: the one home of a pending write, inside the review dock. A write never runs from
// Mosaic's page: its one button asks the site, and the site's own approval sheet, in a window on
// the site's origin, is the only place the person can approve it. Once answered, the card is the
// receipt; the activity log keeps it too. An unknown outcome is never offered again: the site may
// have done it, so the card says to check the site instead.
import { ArrowUpRightIcon, CheckIcon, HourglassMediumIcon, ProhibitIcon, QuestionIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { capAnchor, type CapRef } from "../doc";
import { fmtTime } from "../format";
import { Button, Origin, Provenance, Tag, useHueStyle } from "../primitives";
import { InputFields } from "../runbook";
import { useMosaic } from "../state";
import { resultLinks, writeStatus, type WriteStatus } from "./status";

const STATUS_TAG: Partial<Record<WriteStatus, { tone: "warning" | "success" | "danger"; text: string }>> = {
  waiting: { tone: "warning", text: "Waiting for you" },
  done: { tone: "success", text: "Published" },
  denied: { tone: "danger", text: "Denied" },
  failed: { tone: "danger", text: "Failed" },
  unknown: { tone: "warning", text: "Outcome unknown" },
  not_started: { tone: "warning", text: "Not started" },
};

/** One pending write: what it changes, its inputs, and the button that asks the site. */
export function WriteCard({ r, index, offPlan }: { r: CapRef; index?: number; offPlan?: boolean }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key] ?? { status: "idle" };
  const status = writeStatus(state, r);
  const name = r.siteName;
  const busy = state.confirming ?? state.asking;
  const confirmingName = busy ? (model.connFor(busy)?.site.site.name ?? busy) : null;
  const reason = !model.readyOf(r.origin)
    ? `Waiting for ${name} to answer`
    : status === "waiting"
      ? `Answer ${name}'s prompt first`
      : status === "running"
        ? "Sending now"
        : confirmingName
          ? `Answer ${confirmingName}'s prompt first`
          : state.writing
            ? "Another change is still being sent. One at a time."
            : null;
  const tag = STATUS_TAG[status];
  // The moment a write is published: the number turns into a filled check and the card glows once.
  const [justDone, setJustDone] = useState(false);
  const was = useRef(status);
  useEffect(() => {
    if (status === "done" && was.current !== "done") {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1600);
      was.current = status;
      return () => clearTimeout(t);
    }
    was.current = status;
  }, [status]);
  return (
    <article className={`wcard cap ${status} ${offPlan ? "off-plan" : ""} ${justDone ? "just-done" : ""}`} data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)} style={hue(r.origin)}>
      <header className="wcard-head">
        <span className="wcard-num" aria-hidden="true">
          {status === "done" ? <CheckIcon weight="bold" /> : status === "unknown" ? <QuestionIcon weight="bold" /> : status === "denied" || status === "failed" ? <ProhibitIcon weight="bold" /> : (index ?? "·")}
        </span>
        <h3>{r.cap.title}</h3>
        {tag && (
          <Tag tone={tag.tone} size="sm">
            {tag.text}
          </Tag>
        )}
        <Provenance name={r.siteName} origin={r.origin} />
      </header>
      {status !== "done" && status !== "unknown" && (
        <div className="wcard-body">
          <InputFields r={r} compact />
        </div>
      )}
      {status === "done" && run.status === "done" ? (
        <div className="output wcard-receipt">
          <CheckIcon weight="bold" aria-hidden="true" />
          <span>
            Published on <b>{name}</b> at {fmtTime(run.at)}
          </span>
          {resultLinks(run.output, r.origin).map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className="wcard-link">
              {l.path}
              <ArrowUpRightIcon aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : status === "unknown" ? (
        <div className="output wcard-unknown" role="status">
          <QuestionIcon weight="bold" aria-hidden="true" />
          <span>
            Outcome unknown, check <b>{name}</b>. It may have gone through, so Mosaic won't send it again.
          </span>
          <a href={r.origin} target="_blank" rel="noreferrer" className="wcard-link">
            Open {name}
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        </div>
      ) : (
        <footer className="wcard-foot">
          <Button variant="secondary" size="sm" icon={status === "waiting" ? <HourglassMediumIcon /> : undefined} onClick={() => void actions.run(r)} disabledReason={reason}>
            {status === "denied" || status === "failed" || status === "not_started" ? `Ask ${name} again` : `Approve on ${name}`}
          </Button>
          <span className="wcard-where">
            <Origin origin={r.origin} />
          </span>
          <span className="hint">{status === "waiting" ? `${name} is showing its prompt now.` : `Opens ${name}'s own window. Nothing changes until you approve there.`}</span>
        </footer>
      )}
      {run.status === "error" && !run.unknown && (
        <p className={`wcard-error output-error ${run.denied ? "denied" : ""} ${run.notStarted ? "not-started" : ""}`}>
          {run.denied ? <ProhibitIcon aria-hidden="true" /> : <WarningIcon aria-hidden="true" />}
          <span>{run.denied ? `Denied on ${name}. Nothing changed.` : run.notStarted ? `Not started. Nothing was sent to ${name}.` : `${name} said: ${run.message}`}</span>
        </p>
      )}
    </article>
  );
}
