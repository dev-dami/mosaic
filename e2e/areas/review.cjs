// Selectors for Area C "review". Owner: the review builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
// Pending writes live in the review dock at the bottom of the page; helpers that need a card on
// screen open the dock first.
const { origin } = require("./shell.cjs");

/** Open the review dock if it is closed (its toggle carries aria-expanded). */
async function openDock(page) {
  const toggle = page.locator(".rv-bar [data-review-toggle]");
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.locator(".rv-dock.open").waitFor();
}

module.exports = {
  /** A write capability's card (wherever pending writes are reviewed). */
  writeCard: (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`),
  /** Wait until one of the card's inputs is bound to `ref` ("<origin>#<capability>|<field>"). */
  waitBoundTo: async (card, ref) => {
    await openDock(card.page());
    await card.locator(`[data-flow-dst="${ref}"]`).waitFor();
  },
  /** Ask for this write: opens the site's own approval sheet. */
  start: async (card, _title) => {
    await openDock(card.page());
    await card.getByRole("button", { name: /^(Approve on|Ask .* again)/ }).click();
  },
  /** The site's own approval sheet: its bridge iframe, on the site's origin. */
  sheet: (page, port) => page.frameLocator(`iframe.bridge[data-origin="${origin(port)}"]`),
  /** Wait until the sheet lists a value containing this text. */
  waitSheetValue: (sheet, text) => sheet.locator("dd").getByText(text).first().waitFor(),
  deny: (sheet) => sheet.getByRole("button", { name: "Deny" }).click(),
  approveButton: (sheet) => sheet.getByRole("button", { name: "Approve" }),
  /** Wait until the card says the person denied the write. */
  waitDenied: (card) => card.locator(".output-error.denied").getByText("Nothing changed").waitFor(),
  /** Wait until the card's receipt contains this text (for example the result's link). */
  waitReceipt: (card, text) => card.locator(".output").getByText(text).waitFor({ state: "attached" }),
};
