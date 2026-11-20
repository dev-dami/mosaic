// Selectors for Area C "review". Owner: the review builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
// Pending writes live in the review dock at the bottom of the page; helpers that need a card on
// screen open the dock first. A write's approval sheet is the site's own page, in a popup window on
// the site's origin (the nsdeploy action bridge), opened from Mosaic's "Open <site> to approve".
const { origin } = require("./shell.cjs");

/** Open the review dock if it is closed (its toggle carries aria-expanded). */
async function openDock(page) {
  const toggle = page.locator(".rv-bar [data-review-toggle]");
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.locator(".rv-dock.open").waitFor();
}

module.exports = {
  openDock,
  /** A write capability's card (wherever pending writes are reviewed). */
  writeCard: (page, port, id) => page.locator(`.cap[data-origin="${origin(port)}"][data-capability="${id}"]`),
  /** Wait until one of the card's inputs is bound to `ref` ("<origin>#<capability>|<field>"). */
  waitBoundTo: async (card, ref) => {
    await openDock(card.page());
    await card.locator(`[data-flow-dst="${ref}"]`).waitFor();
  },
  /** The card's ask button ("Approve on …" or "Ask … again"), if it has one. */
  askButton: (card) => card.getByRole("button", { name: /^(Approve on|Ask .* again)/ }),
  /**
   * Ask for this write and open the site's own window from Mosaic's "Open <site> to approve".
   * Returns the site's sheet: the popup page, on the site's origin.
   */
  start: async (card, _title) => {
    const page = card.page();
    await openDock(page);
    await card.getByRole("button", { name: /^(Approve on|Ask .* again)/ }).click();
    const open = page.getByRole("button", { name: /^Open .* to approve$/ });
    await open.waitFor();
    const [popup] = await Promise.all([page.waitForEvent("popup"), open.click()]);
    await popup.waitForLoadState("domcontentloaded");
    return popup;
  },
  /** Wait until the sheet lists a value containing this text. */
  waitSheetValue: (sheet, text) => sheet.locator("dd").getByText(text).first().waitFor(),
  deny: (sheet) => sheet.getByRole("button", { name: "Deny" }).click(),
  approveButton: (sheet) => sheet.getByRole("button", { name: "Approve" }),
  /** Wait until the card says the person denied the write. */
  waitDenied: (card) => card.locator(".output-error.denied").getByText("Nothing changed").waitFor(),
  /** Wait until the card's receipt contains this text (for example the result's link). */
  waitReceipt: (card, text) => card.locator(".output").getByText(text).waitFor({ state: "attached" }),
  /** Wait until the card's status tag reads this ("Published", "Denied", "Outcome unknown"). */
  waitTag: (card, text) => card.locator(".wcard-head").getByText(text, { exact: true }).waitFor(),
  /** Wait until the card says the outcome is unknown and to check the site. */
  waitUnknown: (card) => card.locator(".wcard-unknown").getByText(/Outcome unknown, check/).waitFor(),
};
