// Area C "review" — owner: the review builder.
// Owns src/host/review/** (pending writes, review bar, receipts, toasts, the host side of approval),
// plus providers/bridge.html, providers/sheet.ts (the site's own approval sheet) and
// providers/home.ts (the demo sites' home pages). Not providers/bridge.ts: its message checks and
// the 700 ms Approve delay are the security model and stay as they are.
// Other areas import only what this file exports. The shell mounts:
//   PublishSection  in the runbook's `footer` slot (every write, gathered for review)
//   ActivityLog     in the runbook's `footer` slot, after PublishSection
//   ReviewDock      at the bottom of the page, for the sticky review bar (today: nothing)
//   ApprovalLayer   at the root: the bridge iframes and the site's own sheet
import "./review.css";

export { ActivityLog } from "./activity";
export { ApprovalLayer } from "./approval";
export { PublishSection } from "./publish";

/** Mount point for the sticky review bar. Today it renders nothing. */
export function ReviewDock() {
  return null;
}
