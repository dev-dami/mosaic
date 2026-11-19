// The runbook document: one frame holding the outcome header (entry area), one step per site,
// and whatever follows the steps (review area). The wires are drawn across the whole frame, so a
// write's inputs in the review area can be joined to the read that feeds them.
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { useRef, type ReactNode } from "react";
import { useMosaic } from "../state";
import { Step } from "./step";
import { Wires } from "./wires";

export type RunbookDocumentProps = {
  /** Above the steps: the outcome header. */
  header?: ReactNode;
  /** Shown instead of the steps when no site is connected. */
  empty?: ReactNode;
  /** Below the steps: pending writes, activity. Elements here may carry data-flow-dst too. */
  footer?: ReactNode;
};

export function RunbookDocument({ header, empty, footer }: RunbookDocumentProps) {
  const { state, model } = useMosaic();
  const docRef = useRef<HTMLDivElement>(null);
  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">
        <main className="doc-scroll">
          <div className="doc" ref={docRef}>
            <Wires container={docRef} pulse={state.pulse} hot={state.hot} />
            {header}
            {state.conns.length === 0 && empty}
            {model.siteOrder.length > 0 && (
              <div className="steps">
                {model.siteOrder.map((o) => (
                  <Step key={o} origin={o} number={model.stepOf.get(o)!} />
                ))}
              </div>
            )}
            {footer}
          </div>
        </main>
      </MotionConfig>
    </LazyMotion>
  );
}
