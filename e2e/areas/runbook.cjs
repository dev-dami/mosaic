// Selectors for Area A "runbook". Owner: the runbook builder. Change the selectors here when the
// UI changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

/** A read capability's block in its step. */
const readBlock = (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`);

module.exports = {
  readBlock,
  /** Type into one of the block's inputs, found by its label. */
  fillInput: (block, label, value) => block.getByLabel(label).fill(value),
  /** Pick one option of an enum input. */
  chooseOption: (block, name) => block.getByRole("radio", { name }).check(),
  /** Press the block's run button (named after the capability). */
  run: (block, title) => block.getByRole("button", { name: title }).click(),
  /** Wait until the block's rendered output has a list item with this text. */
  waitOutputItem: (block, text) => block.locator(".output li").getByText(text).waitFor(),
  /** Wait until the block's rendered output contains this text. */
  waitOutput: (block, text) => block.locator(".output").getByText(text).waitFor(),
};
