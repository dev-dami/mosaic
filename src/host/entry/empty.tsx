// What the runbook shows before any site is connected.
import { hostOf } from "../doc";
import { useMosaic } from "../state";

export function EntryEmpty() {
  const { state, actions } = useMosaic();
  const suggestions = state.host?.suggestions ?? [];
  return (
    <section className="empty">
      {[1, 2, 3].map((n) => (
        <div key={n} className="ghost-step">
          <span className="ghost-num">{n}</span>
          <div className="ghost-lines">
            <span />
            <span />
          </div>
        </div>
      ))}
      <div className="empty-card">
        <h2>Add the sites this outcome needs</h2>
        <p>Paste a site's address under Sources. Mosaic reads the capabilities it publishes and writes them into this runbook as steps you can run. Nothing about the site is built into Mosaic.</p>
        {suggestions.length > 0 && (
          <div className="suggest">
            <span className="dim">Try</span>
            {suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => void actions.connect(s)}>
                {hostOf(s)}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
