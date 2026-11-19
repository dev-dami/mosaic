// Which data flow the person is pointing at, so the runbook can draw that one wire. UI-only state
// of the runbook area: set while an output token, a "feeds" link or an input's source token is
// hovered or focused, cleared when it is left. Nothing outside src/host/runbook reads it.
import { useSyncExternalStore } from "react";
import type { CapKey } from "../doc";

/** An output field of `src`, optionally only where it fills the inputs of `dst`. */
export type Flow = { src: CapKey; field: string; dst?: CapKey } | null;

let flow: Flow = null;
const listeners = new Set<() => void>();

export function setFlow(next: Flow) {
  if (flow === next || (flow && next && flow.src === next.src && flow.field === next.field && flow.dst === next.dst)) return;
  flow = next;
  listeners.forEach((l) => l());
}

export function useFlow(): Flow {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => flow,
    () => flow,
  );
}

/** Pointer and focus handlers that show one flow while the element is hovered or focused. */
export function flowHandlers(f: NonNullable<Flow>, also?: (on: boolean) => void) {
  const on = () => {
    setFlow(f);
    also?.(true);
  };
  const off = () => {
    setFlow(null);
    also?.(false);
  };
  return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}
