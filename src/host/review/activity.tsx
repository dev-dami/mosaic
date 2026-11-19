// The activity log: every run and every write's outcome, newest first.
import { fmtTime } from "../format";
import { Provenance } from "../primitives";
import { useMosaic } from "../state";

export function ActivityLog() {
  const { state } = useMosaic();
  if (state.receipts.length === 0) return null;
  return (
    <section className="activity" aria-label="Activity">
      <h2>Activity</h2>
      <ol>
        {state.receipts.map((rc) => (
          <li key={rc.id} className={`${rc.outcome} ${rc.write ? "write" : "read"}`}>
            <span className="act-mark" aria-hidden="true">
              {rc.outcome === "done" ? (rc.write ? "✓" : "·") : "✕"}
            </span>
            <span className="act-title">{rc.title}</span>
            <Provenance name={rc.siteName} origin={rc.origin} />
            <span className="act-detail">{rc.detail}</span>
            <time>{fmtTime(rc.at)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
