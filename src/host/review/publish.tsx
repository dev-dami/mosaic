// Ready to publish: every write, gathered for review. Each one opens that site's own approval sheet.
import { hostOf, capAnchor, type CapRef } from "../doc";
import { fmtTime } from "../format";
import { Button, Provenance, useHueStyle } from "../primitives";
import { InputFields } from "../runbook";
import { useMosaic } from "../state";

export function PublishSection() {
  const { state, model, actions } = useMosaic();
  const { writes, pendingWrites, siteOrder } = model;
  if (writes.length === 0) return null;
  const sites = new Set(writes.map((w) => w.origin)).size;
  const reason = state.sending ? "Publishing now" : pendingWrites.length === 0 ? "Every change is published" : state.confirming ? "Answer the open approval prompt first" : null;
  return (
    <section className="publish" id="publish">
      <div className="publish-gutter">
        <span className={`publish-num ${pendingWrites.length === 0 ? "done" : ""}`}>{siteOrder.length + 1}</span>
      </div>
      <header className="publish-head">
        <div>
          <h2>Ready to publish</h2>
          <p className="publish-sub">
            {writes.length} change{writes.length === 1 ? "" : "s"} on {sites} site{sites === 1 ? "" : "s"}. Each one opens that site's own approval prompt. Mosaic cannot approve for you.
          </p>
        </div>
        <Button variant="primary" onClick={() => void actions.sendAll()} disabledReason={reason}>
          {pendingWrites.length === 0 ? "All published" : `Review ${pendingWrites.length} on their sites`}
        </Button>
      </header>
      <div className="publish-list">
        {writes.map((w) => (
          <WriteCard key={w.key} r={w} />
        ))}
      </div>
    </section>
  );
}

function WriteCard({ r }: { r: CapRef }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const run = state.runs[r.key] ?? { status: "idle" };
  const waiting = run.status === "running" && state.confirming === r.origin;
  const ready = model.readyOf(r.origin);
  const host = hostOf(r.origin);
  const status = waiting ? "waiting" : run.status;
  const reason = !ready ? `Waiting for ${host} to answer` : waiting ? `Answer the prompt from ${host}` : run.status === "running" ? "Running now" : null;
  return (
    <article className={`write-card cap ${status}`} data-capability={r.cap.id} data-origin={r.origin} id={capAnchor(r.key)} style={hue(r.origin)}>
      <header className="wc-head">
        <span className={`wc-icon ${status}`} aria-hidden="true">
          <span>{run.status === "done" ? "✓" : run.status === "error" ? "✕" : ""}</span>
        </span>
        <h3>{r.cap.title}</h3>
        <span className="changes-tag">Changes {r.siteName}</span>
        <Provenance name={r.siteName} origin={r.origin} />
      </header>
      <InputFields r={r} compact />
      <footer className="wc-foot">
        {run.status === "done" ? (
          <div className="output receipt">
            <span className="receipt-check" aria-hidden="true">
              ✓
            </span>
            <span>
              Approved on <b>{host}</b> · {fmtTime(run.at)}
            </span>
            <OutputLinks output={run.output} origin={r.origin} />
          </div>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void actions.run(r)} disabledReason={reason}>
              {waiting ? `Waiting for ${host}…` : r.cap.title}
            </Button>
            <span className="hint">{waiting ? `Answer the prompt from ${host}` : `Opens ${host}'s own approval prompt`}</span>
          </>
        )}
      </footer>
      {run.status === "error" && <p className={`write-error output-error ${run.denied ? "denied" : ""}`}>{run.denied ? `Denied on ${host}: the person denied this action. Nothing changed.` : run.message}</p>}
    </article>
  );
}

/** Links a write returned (paths on the site's own origin). */
function OutputLinks({ output, origin }: { output: unknown; origin: string }) {
  if (!output || typeof output !== "object") return null;
  const entries = Object.entries(output as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.startsWith("/"));
  return (
    <span className="receipt-links">
      {entries.map(([k, v]) => (
        <a key={k} href={new URL(v as string, origin).href} target="_blank" rel="noreferrer">
          {v as string} ↗
        </a>
      ))}
    </span>
  );
}
