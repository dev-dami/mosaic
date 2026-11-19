// What the runbook shows before any site is connected: one thing to do, said plainly.
import { PlugsConnectedIcon, PlusIcon } from "@phosphor-icons/react";
import { hostOf } from "../doc";
import { Button, EmptyFrame, Kbd } from "../primitives";
import { useMosaic } from "../state";
import { asOrigin, entryUi } from "./ui";

export function EntryEmpty() {
  const { state } = useMosaic();
  const suggestions = (state.host?.suggestions ?? []).map((s) => asOrigin(s)).filter((o): o is string => !!o);
  return (
    <section className="entry-empty">
      <ol className="ghost-route" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <li key={n} className="ghost-stop">
            <span className="ghost-n">{n}</span>
            <span className="ghost-socket">
              <PlusIcon weight="bold" />
            </span>
            <span className="ghost-bar" />
          </li>
        ))}
      </ol>
      <EmptyFrame
        title="No steps yet. Connect the sites this needs."
        actions={
          <>
            <Button variant="primary" size="lg" icon={<PlugsConnectedIcon />} side={<Kbd keys={["mod", "K"]} />} onClick={() => entryUi.openPalette()}>
              Connect a site
            </Button>
            {suggestions.length > 0 && (
              <span className="suggest" aria-label="Suggested sites">
                <span className="suggest-label">Suggested</span>
                {suggestions.map((o) => (
                  <button key={o} type="button" className="suggest-chip" onClick={() => entryUi.openPalette(o, true)}>
                    <span className="suggest-socket" aria-hidden="true">
                      <PlusIcon weight="bold" />
                    </span>
                    {hostOf(o)}
                  </button>
                ))}
              </span>
            )}
          </>
        }
      >
        <p>Paste a site's URL. Mosaic reads the capabilities it publishes and turns them into steps here. Nothing about the site is built into Mosaic.</p>
      </EmptyFrame>
    </section>
  );
}
