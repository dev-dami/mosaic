// What the runbook shows before any site is connected: one block, one thing to do. A title, one
// sentence, the chunky "Connect a site" button, and the suggested sites. The suggestions come from
// this Mosaic's own configuration, so their public manifests are read ahead of time (checked like a
// connection: bound to the origin that served them) to show each site's name and colour. The origin
// is always shown beside the name.
import { PlugIcon, PlusIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useEffect, useState, type CSSProperties } from "react";
import { discoverSite } from "../../protocol";
import { monogram } from "../doc";
import { hueOfColor, siteHue } from "../hue";
import { Button, EmptyFrame, Kbd, Origin } from "../primitives";
import { useMosaic } from "../state";
import { asOrigin, entryUi, knownName, rememberName } from "./ui";

type Preview = { name: string; hue: number };

/** Names and colours of the suggested sites, read from their manifests. Missing until each answers. */
function useSuggestionPreviews(origins: string[]): Record<string, Preview> {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const key = origins.join(",");
  useEffect(() => {
    const ctl = new AbortController();
    const taken: number[] = [];
    (async () => {
      for (const o of origins) {
        try {
          const site = await discoverSite(o, AbortSignal.any([ctl.signal, AbortSignal.timeout(5_000)]));
          rememberName(o, site.site.name);
          const hue = siteHue(o, taken, hueOfColor(site.site.theme_color));
          taken.push(hue);
          setPreviews((p) => ({ ...p, [o]: { name: site.site.name, hue } }));
        } catch {}
      }
    })();
    return () => ctl.abort();
  }, [key]);
  return previews;
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
        <p>Paste a site's URL. Mosaic reads the capabilities it publishes and turns them into steps here; nothing about the site is built into Mosaic.</p>
      </EmptyFrame>
    </section>
  );
}
