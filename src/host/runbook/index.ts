// Area A "runbook" — owner: the runbook builder.
// Owns src/host/runbook/**: the document frame, step blocks, inputs, outputs, data-flow wires.
// Other areas import only what this file exports. Keep these exports and their props stable:
//   RunbookDocument({ header?, empty?, footer? })  the frame the shell mounts
//   InputFields({ r, compact? })                    a capability's field rows (review renders writes with it)
//   OutputView({ value, origin }), Markdown({ source })  content renderers
import "./runbook.css";

export { RunbookDocument, type RunbookDocumentProps } from "./document";
export { InputFields } from "./fields";
export { Markdown, OutputView } from "./output";
