// Write cards: the one home of a pending write, inside the review dock. A write never runs from
// Mosaic's page: its one button asks the site, and the site's own approval sheet is the only place
// the person can approve it. Once answered, the card is the receipt; the activity log keeps it too.
import { ArrowUpRightIcon, CheckIcon, HourglassMediumIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
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
};

/** One pending write: what it changes, its inputs, and the button that asks the site. */
export function WriteCard({ r, index, offPlan }: { r: CapRef; index?: number; offPlan?: boolean }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key] ?? { status: "idle" };
  const status = writeStatus(state, r);
  const name = r.siteName;
  const confirmingName = state.confirming ? (model.connFor(state.confirming)?.site.site.name ?? state.confirming) : null;
  const reason = !model.readyOf(r.origin)
    ? `Waiting for ${name} to answer`
    : status === "waiting"
      ? `Answer ${name}'s prompt first`
      : status === "running"
        ? "Sending now"
        : confirmingName
          ? `Answer ${confirmingName}'s prompt first`
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
            Published on <b>{name}</b> at {fmtTime(run.at)}
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
            {status === "denied" || status === "failed" ? `Ask ${name} again` : `Approve on ${name}`}
          </Button>
          <span className="wcard-where">
            <Origin origin={r.origin} />
          </span>
          <span className="hint">{status === "waiting" ? `${name} is showing its prompt now.` : `Opens ${name}'s own prompt. Nothing changes until you approve there.`}</span>
        </footer>
      )}
      {run.status === "error" && (
        <p className={`wcard-error output-error ${run.denied ? "denied" : ""}`}>
          {run.denied ? <ProhibitIcon aria-hidden="true" /> : <WarningIcon aria-hidden="true" />}
          <span>{run.denied ? `Denied on ${name}. Nothing changed.` : `${name} said: ${run.message}`}</span>
        </p>
      )}
    </article>
  );
}
