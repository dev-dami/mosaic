// Selectors for Area B "entry". Owner: the entry builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

module.exports = {
  /** Connect the site on `port` by URL and wait until its bridge is ready. */
  async connect(page, port) {
    await page.getByLabel("Site URL").fill(origin(port));
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.locator(`.source.ready[data-origin="${origin(port)}"]`).waitFor();
  },
  /** Type a document property (Project or Version) over the value read from the outcome. */
  async setDocProp(page, label, value) {
    await page.getByLabel(label, { exact: true }).fill(value);
  },
};
