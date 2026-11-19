// The host side of approval: one hidden iframe per site, on the site's own origin, and the layer
// that shows a site's own approval sheet when it asks. Mosaic only frames the sheet; the site
// draws it and handles the click (providers/bridge.ts). Do not draw over the iframe.
import { useEffect, useRef } from "react";
import type { Site } from "../../protocol";
import { hostOf } from "../doc";
import { useHueStyle } from "../primitives";
import { useMosaic } from "../state";

export function ApprovalLayer() {
  const { state, model } = useMosaic();
  const hue = useHueStyle();
  const waitingOn = model.waitingOn;
  const open = !!state.confirming;
  return (
    <div className={`sheet-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="sheet-backdrop" />
      <div className="sheet-stage">
        {waitingOn && (
          <div className="sheet-label" style={hue(waitingOn.site.site.origin)}>
            <span className="lock-glyph" aria-hidden="true" />
            <span>
              Shown by <b>{hostOf(waitingOn.site.site.origin)}</b>. Mosaic can't see or press this.
            </span>
          </div>
        )}
        {state.conns.map((c) => (
          <BridgeFrame key={c.key} site={c.site} visible={state.confirming === c.site.site.origin} />
        ))}
        {waitingOn && <div className="sheet-wait">Waiting for you to answer {waitingOn.site.site.name}</div>}
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
