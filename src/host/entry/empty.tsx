// What the runbook shows before any site is connected: one block, one thing to do. A title, one
// sentence, the chunky "Connect a site" button, and the suggested sites (by the name last seen in
// this browser when there is one, always with the origin beside it).
import { PlugIcon, PlusIcon } from "@phosphor-icons/react";
import { Button, EmptyFrame, Kbd, Origin } from "../primitives";
import { useMosaic } from "../state";
import { asOrigin, entryUi, knownName } from "./ui";

export function EntryEmpty() {
  const { state } = useMosaic();
  const suggestions = (state.host?.suggestions ?? []).map((s) => asOrigin(s)).filter((o): o is string => !!o);
  return (
    <section className="entry-empty">
      <EmptyFrame
        title="Connect the sites this needs"
        icon={<PlugIcon />}
        actions={
          <>
            <Button variant="primary" size="lg" icon={<PlugIcon />} side={<Kbd keys={["mod", "K"]} />} onClick={() => entryUi.openPalette()}>
              Connect a site
            </Button>
            {suggestions.length > 0 && (
              <span className="suggest" aria-label="Suggested sites">
                <span className="suggest-label">Suggested</span>
                {suggestions.map((o) => {
                  const name = knownName(o);
                  return (
                    <button key={o} type="button" className="suggest-chip" onClick={() => entryUi.openPalette(o, true)} aria-label={`Connect ${name ?? o}`}>
                      <span className="suggest-socket" aria-hidden="true">
                        <PlusIcon weight="bold" />
                      </span>
                      {name && <span className="suggest-name">{name}</span>}
                      <Origin origin={o} />
                    </button>
                  );
                })}
              </span>
            )}
          </>
        }
      >
        <p>Paste a site's URL. Mosaic reads the capabilities it publishes and turns them into steps here; nothing about the site is built into Mosaic.</p>
      </EmptyFrame>
    </section>
  );
}
