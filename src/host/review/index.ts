// Area C "review" — owner: the review builder.
// Owns src/host/review/** (pending writes, review dock, receipts, toasts, the host side of approval),
// plus providers/bridge.html, providers/sheet.ts (the site's own approval sheet) and
// providers/home.ts (the demo sites' home pages). Not providers/bridge.ts: its message checks and
// the 700 ms Approve delay are the security model and stay as they are.
// Other areas import only what this file exports. The shell mounts:
//   ActivityLog     in the runbook's `footer` slot: every run and every write's answer
//   ReviewDock      the one home of pending writes: the review bar on the document column, its
//                   drawer of write cards (a side panel on wide screens), and the toasts
//   ApprovalLayer   at the root: the bridge iframes and the site's own sheet
// Other areas may call openReview(capKey?) to open the dock (for example from the ⌘K palette), and
// a plain link to `#${capAnchor(writeKey)}` anywhere on the page opens the dock at that write.
import "./review.css";

export { ActivityLog } from "./activity";
export { ApprovalLayer } from "./approval";
export { ReviewDock } from "./dock";
export { closeReview, openReview } from "./ui";
