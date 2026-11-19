// Area A "runbook" — owner: the runbook builder.
// Owns src/host/runbook/**: the document frame, step blocks, inputs (sentence + rows), outputs
// (markdown, word diffs via jsdiff, tables), hand-drawn data-flow wires (perfect-freehand), details popover.
// Other areas import only what this file exports. Keep these exports and their props stable:
//   RunbookDocument({ header?, empty?, footer? })  the frame the shell mounts
//   InputFields({ r, compact?, only? })             a capability's field rows (review renders writes with it)
//   OutputView({ value, origin }), Markdown({ source })  content renderers
import "./runbook.css";

export { RunbookDocument, type RunbookDocumentProps } from "./document";
export { InputFields } from "./fields";
export { Markdown, OutputView } from "./output";
