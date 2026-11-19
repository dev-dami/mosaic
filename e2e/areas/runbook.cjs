// Selectors for Area A "runbook". Owner: the runbook builder. Change the selectors here when the
// UI changes; keep each function's meaning (its comment) the same.
//
// A read block shows its inputs as one sentence of chips; only fields that still need the person
// are open as rows. "Edit inputs" opens every field, so the helpers open it when a field is folded.
const { origin } = require("./shell.cjs");

/** A read capability's block in its step. */
const readBlock = (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`);

/** Make sure `locator` (inside `block`) is on screen, opening the block's fields if they are folded. */
async function reveal(block, locator) {
  if (await locator.count()) return locator;
  await block.getByRole("button", { name: "Edit inputs" }).click();
  await locator.first().waitFor();
  return locator;
}

module.exports = {
  readBlock,
  /** Type into one of the block's inputs, found by its label. */
  fillInput: async (block, label, value) => (await reveal(block, block.getByLabel(label))).fill(value),
  /** Pick one option of an enum input. */
  chooseOption: async (block, name) => (await reveal(block, block.getByRole("radio", { name }))).check(),
  /** Press the block's run button (named after the capability). */
  run: (block, title) => block.getByRole("button", { name: `Run ${title}` }).click(),
  /** Wait until the block's rendered output has a list item with this text. */
  waitOutputItem: (block, text) => block.locator(".output li").getByText(text).waitFor(),
  /** Wait until the block's rendered output contains this text. */
  waitOutput: (block, text) => block.locator(".output").getByText(text).waitFor(),
  /** The hand-drawn wires drawn for bound inputs (desktop widths only), while a flow is pointed at. */
  wires: (page) => page.locator("svg.wires .wire"),
  /** Point at one of the block's output fields (its token in the "feeds" row), which draws its wires. */
  pointAtOutput: (block, field) => block.locator(`.out-token[data-flow-src$="|${field}"]`).hover(),
  /** The "feeds" link from a block's output token to a later step that takes it. */
  feedTarget: (block, title) => block.locator(".feed-target", { hasText: title }),
};
