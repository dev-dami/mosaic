// What the runbook shows before any site is connected: one block, one thing to do. A title, one
// sentence, the chunky "Connect a site" button, and the suggested sites. The suggestions come from
// this Mosaic's own configuration, but no site is contacted before the
// person consents to connect it: a chip shows a name only if this browser connected the site before. The origin
// is always shown beside the name.
import { PlugIcon, PlusIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useMemo, useState, type CSSProperties } from "react";
import { monogram } from "../doc";
import { siteHue } from "../hue";
import { Button, EmptyFrame, Kbd, Origin } from "../primitives";
import { useMosaic } from "../state";
import { asOrigin, entryUi, knownName } from "./ui";

type Preview = { name: string; hue: number };

/**
 * Names and colours of the suggested sites, without contacting them: nothing goes to a site before
 * the person consents to connect it. The name is the one this browser saw on an earlier connection
 * (if any); the colour is the host's hue for the origin.
 */
function useSuggestionPreviews(origins: string[]): Record<string, Preview> {
  return useMemo(() => {
    const taken: number[] = [];
    const out: Record<string, Preview> = {};
    for (const o of origins) {
      const name = knownName(o);
      if (!name) continue;
      const hue = siteHue(o, taken);
      taken.push(hue);
      out[o] = { name, hue };
    }
    return out;
  }, [origins.join(",")]);
}

export function EntryEmpty() {
  const { state, actions } = useMosaic();
  const suggestions = (state.host?.suggestions ?? []).map((s) => asOrigin(s)).filter((o): o is string => !!o);
  const previews = useSuggestionPreviews(suggestions);
  const [connectingAll, setConnectingAll] = useState(false);
  const connectAll = async () => {
    setConnectingAll(true);
    for (const o of suggestions) await actions.connect(o);
    setConnectingAll(false);
  };
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
                  const preview = previews[o];
                  const name = preview?.name ?? knownName(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      className={`suggest-chip ${preview ? "known" : ""}`}
                      style={preview ? ({ "--h": String(preview.hue) } as CSSProperties) : undefined}
                      onClick={() => entryUi.openPalette(o, true)}
                      aria-label={`Connect ${name ?? o}`}
                    >
                      <span className="suggest-socket" aria-hidden="true">
                        {preview ? monogram(preview.name) : <PlusIcon weight="bold" />}
                      </span>
                      {name && <span className="suggest-name">{name}</span>}
                      <Origin origin={o} />
                    </button>
                  );
                })}
                {suggestions.length > 1 && (
                  <Button variant="secondary" size="sm" icon={<PlugsConnectedIcon />} disabledReason={connectingAll && "Connecting the suggested sites"} onClick={connectAll}>
                    {connectingAll ? "Connecting…" : `Connect all ${suggestions.length}`}
                  </Button>
                )}
              </span>
            )}
          </>
        }
      >
        <p>Paste a site's URL. Mosaic loads the agent network it publishes and turns its actions into steps here; nothing about the site is built into Mosaic.</p>
      </EmptyFrame>
    </section>
  );
}
