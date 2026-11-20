// Selectors for the agent turn (src/host/runbook/turn.tsx, the outcome's mode line). Owner: C9.
// Change selectors here when the UI changes; keep each function's meaning (its comment) the same.
const { origin } = require("./shell.cjs");

module.exports = {
  /** The line under the outcome that names the mode ("manual" or "model"). */
  modeLine: (page, mode) => page.locator(`.mode-line[data-mode="${mode}"]`),
  /** Replace the outcome sentence. */
  setOutcome: (page, text) => page.locator("#outcome").fill(text),
  /** Submit the outcome (Enter in the outcome box). */
  submitOutcome: (page) => page.locator("#outcome").press("Enter"),
  /** The agent runbook of the latest turn. */
  turn: (page) => page.locator(".agent-turn"),
  /** "Model: <model> at <router host>". */
  modelLabel: (page) => page.getByTestId("turn-model"),
  /** Mosaic's own composer step. */
  composerStep: (page) => page.locator(".agent-step.composer"),
  /** The peer-call step for the site on `port`. */
  peerStep: (page, port) => page.locator(`.agent-step.peer[data-origin="${origin(port)}"]`),
  /** The turn's Stop button. */
  stopButton: (page) => page.locator(".agent-turn-head").getByRole("button", { name: "Stop" }),
};
