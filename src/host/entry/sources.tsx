// The sources rail: connected sites, their capabilities, and the form that connects a new site.
import { useState } from "react";
import { capAnchor, capKey } from "../doc";
import { Button, Monogram, Origin, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { TraceList } from "./trace";

export function SourcesRail() {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const [url, setUrl] = useState("");
  const busy = !!state.trace?.stages.some((s) => s.state === "doing");
  const reason = !url.trim() ? "Paste a site URL first" : busy ? "Connecting…" : null;
  const submit = async () => {
    if (reason) return;
    // Clear the field once the site is in; keep it on error so it can be fixed.
    if (await actions.connect(url)) setUrl((u) => (u === url ? "" : u));
  };
  return (
    <aside className="rail" aria-label="Sources">
      <div className="rail-head">
        <h2>Sources</h2>
        <span className="count">{state.conns.length}</span>
      </div>
      <ul className="sources">
        {model.siteOrder.map((o) => {
          const c = model.connFor(o)!;
          return (
            <li key={c.key} className={`source ${c.status} ${state.fresh.includes(o) ? "fresh" : ""}`} data-origin={o} style={hue(o)}>
              <div className="source-row">
                <Monogram name={c.site.site.name} origin={o} ring={c.status === "connecting" ? "running" : c.status === "failed" ? "failed" : undefined} />
                <div className="source-id">
                  <div className="source-name">{c.site.site.name}</div>
                  <Origin origin={o} />
                </div>
                <span className={`status-dot ${c.status}`} title={c.status === "ready" ? "Bridge ready" : c.status === "failed" ? "Refused" : "Connecting"} />
                <button className="icon-btn" onClick={() => actions.disconnect(o)} aria-label={`Disconnect ${c.site.site.name}`}>
                  ×
                </button>
              </div>
              {c.failure && <p className="source-fail">{c.failure}</p>}
              <ul className="caps">
                {c.site.capabilities.map((cap) => (
                  <li key={cap.id}>
                    <a href={`#${capAnchor(capKey(o, cap.id))}`} className={cap.side_effects}>
                      <span className="eff" aria-hidden="true" />
                      {cap.title}
                      {cap.side_effects === "write" && <span className="sr-only"> (changes the site)</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <form
        className="add-site"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="site-url" className="add-label">
          Add a site
        </label>
        <div className="add-row">
          <input id="site-url" aria-label="Site URL" placeholder="https://… or localhost:4103" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button type="submit" size="sm" variant="primary" disabledReason={reason}>
            Connect
          </Button>
        </div>
      </form>
      {state.connectError && (
        <p className="rail-error" role="alert">
          {state.connectError}
        </p>
      )}
      {state.trace && <TraceList trace={state.trace} />}
      <p className="rail-foot">Mosaic ships with no integrations. Every block in this runbook comes from a site's own manifest.</p>
    </aside>
  );
}
