// Area B "entry" — owner: the entry builder.
// Owns src/host/entry/**: the outcome input, the ⌘K palette, the connect flow and its staged
// checks, the sources list, the refused-host state, and plan.ts (how the outcome picks and orders
// steps). Other areas import only what this file exports. The shell mounts:
//   EntryTopbar     inside the top bar, before the build badge (today: nothing)
//   SourcesRail     the left column (it sets its own width; the layout grid is `auto 1fr`)
//   OutcomeHeader   the runbook's `header` slot
//   EntryEmpty      the runbook's `empty` slot
//   EntryOverlays   at the root, for the palette (today: nothing)
import "./entry.css";

export { EntryEmpty } from "./empty";
export { OutcomeHeader } from "./outcome";
export { SourcesRail } from "./sources";
export { stageLabel } from "./trace";

/** Mount point inside the top bar. Today it renders nothing. */
export function EntryTopbar() {
  return null;
}

/** Mount point at the root, for the command palette. Today it renders nothing. */
export function EntryOverlays() {
  return null;
}
