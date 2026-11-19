// The activity log: every run and every write's answer, newest first, as a dense table with each
// site's hue on a thin left ribbon. The latest few show; the rest are one click away.
import { useState } from "react";
import { hostOf } from "../doc";
import { fmtTime } from "../format";
import { Monogram, useHueStyle } from "../primitives";
import { useMosaic } from "../state";

const SHOWN = 4;

export function ActivityLog() {
  const { state } = useMosaic();
  const hue = useHueStyle();
  const [all, setAll] = useState(false);
  if (state.receipts.length === 0) return null;
  const rows = all ? state.receipts : state.receipts.slice(0, SHOWN);
  return (
    <section className="activity" aria-label="Activity">
      <header className="activity-head">
        <h2 className="label">Activity</h2>
        {state.receipts.length > SHOWN && (
          <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
            {all ? "Show latest" : `Show all ${state.receipts.length}`}
          </button>
        )}
      </header>
      <table className="act-table">
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">Site</th>
            <th scope="col">Result</th>
            <th scope="col" className="act-time">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rc) => (
            <tr key={rc.id} className={`${rc.outcome} ${rc.write ? "write" : "read"}`} style={hue(rc.origin)}>
              <td className="act-what">
                <span className="act-kind">{rc.write ? "write" : "read"}</span>
                {rc.title}
              </td>
              <td>
                <span className="act-site">
                  <Monogram name={rc.siteName} origin={rc.origin} size="sm" />
                  <span>{hostOf(rc.origin)}</span>
                </span>
              </td>
              <td className="act-result">
                <span className={`act-dot ${rc.outcome}`} aria-hidden="true" />
                {rc.outcome === "done" ? (rc.write ? "Approved" : "Read") : rc.outcome === "denied" ? "Denied, nothing changed" : rc.detail}
              </td>
              <td className="act-time">
                <time>{fmtTime(rc.at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
