// Area C "review" — owner: the review builder.
// Owns src/host/review/** (pending writes, review dock, receipts, toasts, the host side of approval),
// plus providers/bridge.html, providers/sheet.ts (the site's own approval sheet) and
// providers/home.ts (the demo sites' home pages). Not providers/bridge.ts: its message checks and
// the 700 ms Approve delay are the security model and stay as they are.
// Other areas import only what this file exports. The shell mounts:
//   PublishSection  in the runbook's `footer` slot: receipts of answered writes (stubs)
//   ActivityLog     in the runbook's `footer` slot, after PublishSection
//   ReviewDock      at the bottom of the page: the floating review bar, its write cards, the toasts
//   ApprovalLayer   at the root: the bridge iframes and the site's own sheet
// Other areas may call openReview(capKey?) to open the dock (for example from the ⌘K palette), and
// a plain link to `#${capAnchor(writeKey)}` anywhere on the page opens the dock at that write.
import "./review.css";

export { ActivityLog } from "./activity";
export { ApprovalLayer } from "./approval";
export { ReviewDock } from "./dock";
export { PublishSection } from "./publish";
export { closeReview, openReview } from "./ui";
