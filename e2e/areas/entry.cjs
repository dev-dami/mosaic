// Selectors for Area B "entry". Owner: the entry builder. Change the selectors here when the UI
// changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

/** Type a site URL into the palette, press Enter, and allow the consent dialog that names its host. */
async function typeAndAllow(page, url) {
  // The top bar's palette trigger; ⌘K / Ctrl K opens the same palette.
  await page.getByRole("button", { name: "Search or connect a site" }).click();
  const input = page.getByLabel("Site URL or search");
  await input.fill(url);
  await input.press("Enter");
  const host = new URL(url).host;
  const consent = page.getByRole("dialog", { name: `Connect ${host}?` });
  await consent.waitFor();
  await consent.getByRole("button", { name: "Allow", exact: true }).click();
}

module.exports = {
  /** Connect the site on `port` by URL (bare origin, or `<origin>/<network>`) and wait until it is ready. */
  async connect(page, port, network) {
    await typeAndAllow(page, network ? `${origin(port)}/${network}` : origin(port));
    await page.locator(`.source.ready[data-origin="${origin(port)}"]`).waitFor();
    // The palette stays open on "+N capabilities from <host>" until dismissed.
    await page.keyboard.press("Escape");
    await page.locator(".palette").waitFor({ state: "detached" });
  },
  /** Try to connect a URL that must be refused; returns the palette's visible refusal box. */
  async connectRefused(page, url) {
    await typeAndAllow(page, url);
    const box = page.locator(".palette .refused-box[role=alert]");
    await box.waitFor();
    return box;
  },
  /** Disconnect a connected site from its chip in the sources rail. */
  async disconnect(page, port) {
    await page.locator(`.source[data-origin="${origin(port)}"] .source-btn`).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.locator(`.source[data-origin="${origin(port)}"]`).waitFor({ state: "detached" });
  },
  /** Close the palette. */
  async closePalette(page) {
    await page.keyboard.press("Escape");
    await page.locator(".palette").waitFor({ state: "detached" });
  },
  /** Type a document property (Project or Version) over the value read from the outcome. */
  async setDocProp(page, label, value) {
    await page.getByLabel(label, { exact: true }).fill(value);
  },
};
