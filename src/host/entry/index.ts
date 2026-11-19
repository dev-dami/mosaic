// Area B "entry" — owner: the entry builder.
// Owns src/host/entry/**: the outcome input, the ⌘K palette, the connect flow and its staged
// checks, the sources dock, the refused-host state, and plan.ts (how the outcome picks and orders
// steps). Other areas import only what this file exports. The shell mounts:
//   EntryTopbar     inside the top bar, before the build badge: the palette trigger
//   SourcesRail     the left column: a slim dock of site monograms (a strip on phones)
//   OutcomeHeader   the runbook's `header` slot: the outcome input and the plan line
//   EntryEmpty      the runbook's `empty` slot
//   EntryOverlays   at the root: the ⌘K palette
import "./entry.css";

export { EntryEmpty } from "./empty";
export { OutcomeHeader } from "./outcome";
export { Palette as EntryOverlays } from "./palette";
export { SourcesRail } from "./sources";
export { EntryTopbar } from "./topbar";
export { checkRows, refusalOf } from "./trace";
/** Open the palette from another area, for example a "Connect a site" link: entryUi.openPalette(). */
export { entryUi } from "./ui";
