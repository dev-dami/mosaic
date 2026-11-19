// UI-only state shared inside the entry area: whether the palette is open (and what it opened
// with), and the last connection checks seen for each origin, so a source's popover can show
// them after the palette is gone. Not workspace state: nothing outside src/host/entry reads it.
import { useSyncExternalStore } from "react";
import type { Trace } from "../state";

type EntryUi = {
  open: boolean;
  /** Text to put in the palette input when it opens (a suggested URL, or ""). */
  seed: string;
  /** Connect the seed at once when the palette opens. */
  autoConnect: boolean;
  /** Bumped to ask the outcome input to take focus. */
  focusOutcome: number;
};

let ui: EntryUi = { open: false, seed: "", autoConnect: false, focusOutcome: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<EntryUi>) => {
  ui = { ...ui, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useEntryUi(): EntryUi {
  return useSyncExternalStore(subscribe, () => ui, () => ui);
}

export const entryUi = {
  /** Open the palette, optionally with a URL typed in, optionally connecting it at once. */
  openPalette(seed = "", autoConnect = false) {
    set({ open: true, seed, autoConnect });
  },
  closePalette() {
    set({ open: false, seed: "", autoConnect: false });
  },
  setOpen(open: boolean) {
    if (open) set({ open });
    else entryUi.closePalette();
  },
  focusOutcome() {
    set({ open: false, focusOutcome: ui.focusOutcome + 1 });
  },
};

/** The last trace seen per origin. Written by the always-mounted sources rail. */
const traces = new Map<string, Trace>();
export const rememberTrace = (t: Trace) => traces.set(t.origin, t);
export const traceOf = (origin: string) => traces.get(origin);

/** A typed string that looks like a site address, as an origin; null for search text. */
export function asOrigin(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (!t.includes("://") && !/^localhost(:\d+)?(\/.*)?$/i.test(t) && !/^[\w-]+(\.[\w-]+)*\.[a-z][\w-]*(:\d+)?(\/.*)?$/i.test(t) && !/^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(t)) return null;
  const withScheme = t.includes("://") ? t : `${/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/i.test(t) ? "http" : "https"}://${t}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
