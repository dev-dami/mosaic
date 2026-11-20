// The host side of approval. A write never runs on Mosaic's page: the runtime opens the site's
// action bridge in a window on the site's own origin, and the site's own sheet asks the person
// (providers/bridge-actions.ts with confirmsInWindow). Browsers open a window only inside a click,
// so this layer first asks "Open <site> to approve"; while the window is up it says where the
// answer is. Mosaic can neither see nor press the site's sheet.
import { ArrowSquareOutIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { hostOf } from "../doc";
import { Button, Monogram, useHueStyle } from "../primitives";
import { useMosaic } from "../state";

export function ApprovalLayer() {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const origin = state.asking ?? state.confirming;
  const open = !!origin;
  const conn = origin ? model.connFor(origin) : undefined;
  const name = conn?.site.site.name ?? (origin ? hostOf(origin) : "");
  return (
    <div className={`sheet-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="sheet-backdrop" />
      {origin && (
        <div className="sheet-stage" style={hue(origin)} role="dialog" aria-modal="true" aria-label={`Approve on ${name}`}>
          <div className="sheet-label">
            <LockSimpleIcon weight="bold" aria-hidden="true" />
            <span>
              Changes are approved on <b>{hostOf(origin)}</b>'s own page. Mosaic can't see or press it.
            </span>
          </div>
          {state.asking ? (
            <div className="approve-ask">
              <Monogram name={name} origin={origin} size="lg" />
              <p>
                <b>{name}</b> shows what will change and asks you there. Nothing is sent until you approve in its window.
              </p>
              {state.popupBlocked && (
                <p className="approve-blocked" role="alert">
                  Your browser blocked {name}'s window. Allow pop-ups for this page, then press Open again.
                </p>
              )}
              <div className="approve-ask-actions">
                <Button variant="tertiary" onClick={actions.cancelApproval}>
                  Cancel
                </Button>
                <Button variant="primary" icon={<ArrowSquareOutIcon />} onClick={actions.openApproval} autoFocus>
                  Open {name} to approve
                </Button>
              </div>
            </div>
          ) : (
            <div className="sheet-wait" aria-live="polite">
              <Monogram name={name} origin={origin} size="sm" />
              <span>Mosaic is waiting for your answer in {name}'s window</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
