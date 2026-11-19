// Selectors for Area C "review". Owner: the review builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

module.exports = {
  /** A write capability's card (wherever pending writes are reviewed). */
  writeCard: (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`),
  /** Wait until one of the card's inputs is bound to `ref` ("<origin>#<capability>|<field>"). */
  waitBoundTo: (card, ref) => card.locator(`[data-flow-dst="${ref}"]`).waitFor(),
  /** Ask for this write: opens the site's own approval sheet. */
  start: (card, title) => card.getByRole("button", { name: title }).click(),
  /** The site's own approval sheet: its bridge iframe, on the site's origin. */
  sheet: (page, port) => page.frameLocator(`iframe.bridge[data-origin="${origin(port)}"]`),
  /** Wait until the sheet lists a value containing this text. */
  waitSheetValue: (sheet, text) => sheet.locator("dd").getByText(text).waitFor(),
  deny: (sheet) => sheet.getByRole("button", { name: "Deny" }).click(),
  approveButton: (sheet) => sheet.getByRole("button", { name: "Approve" }),
  /** Wait until the card says the person denied the write. */
  waitDenied: (card) => card.locator(".output-error").getByText("the person denied this action").waitFor(),
  /** Wait until the card's receipt contains this text (for example the result's link). */
  waitReceipt: (card, text) => card.locator(".output").getByText(text).waitFor(),
};
