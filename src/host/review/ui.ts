// UI-only state of the review area: whether the review dock is open and which write card it should
// bring into view. It lives here, not in the shared store, because nothing outside this area needs
// it. Other areas open the dock through `openReview()` from review/index.ts.
import { useSyncExternalStore } from "react";
import type { CapKey } from "../doc";

type ReviewUi = { open: boolean; focus: CapKey | null; nonce: number };

let ui: ReviewUi = { open: false, focus: null, nonce: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<ReviewUi>) => {
  ui = { ...ui, ...next };
  listeners.forEach((l) => l());
};

/** Open the review dock, optionally scrolled to one write. */
export function openReview(focus: CapKey | null = null) {
  set({ open: true, focus, nonce: ui.nonce + 1 });
}
export function closeReview() {
  set({ open: false, focus: null });
}
export function toggleReview() {
  if (ui.open) closeReview();
  else openReview();
}

export function useReviewUi(): ReviewUi {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ui,
    () => ui,
  );
}
