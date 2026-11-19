// The host side of approval: one hidden iframe per site, on the site's own origin, and the layer
// that shows a site's own approval sheet when it asks. Mosaic only frames the sheet; the site
// draws it and handles the click (providers/bridge.ts). Mosaic's notes sit above and below the
// frame, never on it.
import { LockSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { Site } from "../../protocol";
import { hostOf } from "../doc";
import { Monogram, useHueStyle } from "../primitives";
import { useMosaic } from "../state";

export function ApprovalLayer() {
  const { state, model } = useMosaic();
  const hue = useHueStyle();
  const waitingOn = model.waitingOn;
  const open = !!state.confirming;
  // Still asking, or has the site answered and its sheet is lingering on "Done" / "Denied"?
  const asking = !!waitingOn && model.writes.some((w) => w.origin === waitingOn.site.site.origin && state.runs[w.key]?.status === "running");
  return (
    <div className={`sheet-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="sheet-backdrop" />
      <div className="sheet-stage">
        {waitingOn && (
          <div className="sheet-label" style={hue(waitingOn.site.site.origin)}>
            <LockSimpleIcon weight="bold" aria-hidden="true" />
            <span>
              This prompt is <b>{hostOf(waitingOn.site.site.origin)}</b>'s own page. Mosaic can't see or press it.
            </span>
          </div>
        )}
        {state.conns.map((c) => (
          <BridgeFrame key={c.key} site={c.site} visible={state.confirming === c.site.site.origin} />
        ))}
        {waitingOn && (
          <div className="sheet-wait" style={hue(waitingOn.site.site.origin)}>
            <Monogram name={waitingOn.site.site.name} origin={waitingOn.site.site.origin} size="sm" />
            <span>{asking ? `Mosaic is waiting for your answer on ${waitingOn.site.site.name}` : `${waitingOn.site.site.name} has your answer. This closes on its own.`}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The site's bridge page. Keyed by connection: one instance per connected site, never re-pointed. */
function BridgeFrame({ site, visible }: { site: Site; visible: boolean }) {
  const { actions } = useMosaic();
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => actions.attachBridge(site, frame.current!), []);
  return <iframe ref={frame} className={visible ? "bridge visible" : "bridge"} data-origin={site.site.origin} title={`${site.site.name} approval`} />;
}
