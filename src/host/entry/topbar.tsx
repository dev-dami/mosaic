// The palette's trigger in the top bar: looks like a search field, opens the palette.
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Kbd } from "../primitives";
import { entryUi } from "./ui";

export function EntryTopbar() {
  return (
    <button type="button" className="cmd-trigger" onClick={() => entryUi.openPalette()} aria-label="Search or connect a site" aria-keyshortcuts="Meta+K Control+K">
      <MagnifyingGlassIcon />
      <span className="cmd-trigger-text">Search steps or connect a site</span>
      <Kbd keys={["mod", "K"]} />
    </button>
  );
}
