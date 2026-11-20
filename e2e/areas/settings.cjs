// Selectors for the AI model settings (src/host/settings). Owner: C6. Change selectors here when the
// UI changes; keep each function's meaning (its comment) the same.
module.exports = {
  /** Open the AI model panel from the top bar and return it. */
  async open(page) {
    await page.getByRole("button", { name: "AI model", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "AI model" });
    await panel.waitFor();
    return panel;
  },
  /** The line that says which mode Mosaic is in ("manual" or "model"). */
  mode: (panel, mode) => panel.locator(`.settings-mode[data-mode="${mode}"]`),
  /** The "Your key is sent only to …" line. */
  keyNote: (panel) => panel.getByTestId("key-note"),
  /** Fill the add-a-model form and save it (it becomes the profile in use). */
  async saveProfile(panel, { router, model, key, name }) {
    await panel.getByLabel("Router base URL").fill(router);
    await panel.getByLabel("Model").fill(model);
    await panel.getByLabel("Key", { exact: true }).fill(key);
    await panel.getByLabel("Name (optional)").fill(name);
    await panel.getByRole("button", { name: "Save and use" }).click();
  },
  /** A saved profile row by its name. */
  profile: (panel, name) => panel.locator(`.profile[data-profile="${name}"]`),
  /** Wait until the named profile is the one in use. */
  waitInUse: (panel, name) => panel.locator(`.profile.on[data-profile="${name}"]`).waitFor(),
  async use(panel, name) {
    await panel.locator(`.profile[data-profile="${name}"]`).getByRole("button", { name: "Use" }).click();
  },
  async remove(panel, name) {
    await panel.getByRole("button", { name: `Delete ${name}` }).click();
    await panel.locator(`.profile[data-profile="${name}"]`).waitFor({ state: "detached" });
  },
  /** Run the panel's one-sentence model check and return the answer line. */
  async testModel(panel) {
    await panel.getByRole("button", { name: "Test model" }).click();
    const line = panel.locator(".check-line.ok, .check-line.error").first();
    await line.waitFor();
    return line;
  },
};
