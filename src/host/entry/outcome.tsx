// The outcome header: the sentence the person types, and the document properties read from it.
import { hostOf } from "../doc";
import { Monogram } from "../primitives";
import { useMosaic } from "../state";

export function OutcomeHeader() {
  const { state, model, actions } = useMosaic();
  const { doneCount, totalCount, waitingOn } = model;
  return (
    <header className="doc-head">
      <div className="kicker">Runbook · {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
      <input className="doc-title" aria-label="Outcome" value={state.title} placeholder="Describe the outcome, e.g. Launch Lumen v1.0" onChange={(e) => actions.setTitle(e.target.value)} />
      <p className="lede">
        Each step runs on a different website, through capabilities that site publishes. Changes wait in <a href="#publish">Ready to publish</a> until you approve each one on its own site.
      </p>
      <dl className="props">
        {(["project", "version"] as const).map((k) => (
          <div key={k} className="prop">
            <dt>
              <label htmlFor={`prop-${k}`}>{k === "project" ? "Project" : "Version"}</label>
            </dt>
            <dd>
              <input id={`prop-${k}`} className="prop-input" value={model.docProps[k]} placeholder="—" onChange={(e) => actions.setProp(k, e.target.value)} />
            </dd>
          </div>
        ))}
        <div className="prop">
          <dt>Sources</dt>
          <dd className="prop-sources">
            {model.siteOrder.length === 0 && <span className="dim">None yet</span>}
            {model.siteOrder.map((o) => (
              <Monogram key={o} name={model.connFor(o)!.site.site.name} origin={o} size="sm" />
            ))}
          </dd>
        </div>
        <div className="prop">
          <dt>Progress</dt>
          <dd className="prop-progress">
            <span className="bar">
              <span style={{ width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%` }} />
            </span>
            <span>
              {doneCount} of {totalCount}
              {waitingOn && <span className="waiting-note"> · approve on {hostOf(waitingOn.site.site.origin)}</span>}
            </span>
          </dd>
        </div>
      </dl>
    </header>
  );
}
