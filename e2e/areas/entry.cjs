// Selectors for Area B "entry". Owner: the entry builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

module.exports = {
  /** Connect the site on `port` by URL and wait until its bridge is ready. */
  async connect(page, port) {
    // The top bar's palette trigger; ⌘K / Ctrl K opens the same palette.
    await page.getByRole("button", { name: "Search or connect a site" }).click();
    const input = page.getByLabel("Site URL or search");
    await input.fill(origin(port));
    await input.press("Enter");
    await page.locator(`.source.ready[data-origin="${origin(port)}"]`).waitFor();
    // The palette stays open on "+N capabilities from <host>" until dismissed.
    await page.keyboard.press("Escape");
    await page.locator(".palette").waitFor({ state: "detached" });
  },
  /** Type a document property (Project or Version) over the value read from the outcome. */
  async setDocProp(page, label, value) {
    await page.getByLabel(label, { exact: true }).fill(value);
  },
};
