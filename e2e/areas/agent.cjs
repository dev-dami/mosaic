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
  turn: (page) => page.locator(".agent-turn.latest"),
  /** Every turn of the conversation, oldest first. */
  turns: (page) => page.locator(".agent-turn"),
  /** "Model: <model> at <router host>" of the latest turn. */
  modelLabel: (page) => page.locator(".agent-turn.latest").getByTestId("turn-model"),
  /** Mosaic's own composer step in the latest turn. */
  composerStep: (page) => page.locator(".agent-turn.latest .agent-step.composer"),
  /** The peer-call step for the site on `port`, in the latest turn. */
  peerStep: (page, port) => page.locator(`.agent-turn.latest .agent-step.peer[data-origin="${origin(port)}"]`),
  /** The latest turn's Stop button. */
  stopButton: (page) => page.locator(".agent-turn.latest .agent-turn-head").getByRole("button", { name: "Stop" }),
  /** Type a reply in the box under the thread and send it (Enter). */
  reply: async (page, text) => {
    const box = page.getByRole("textbox", { name: /^(Reply to Mosaic's agent|Add to this turn)$/ });
    await box.fill(text);
    await box.press("Enter");
  },
  /** The person's follow-up messages in the thread ("You"). */
  youSaid: (page) => page.locator(".you-said"),
  /** A next-step button over the reply box ("Continue", "Review 2 changes", "Try again"). */
  nextStep: (page, label) => page.locator(".next-steps").getByRole("button", { name: label }),
  /** A widget the agent returned, by its component id (in any turn). */
  widget: (page, id) => page.locator(`.widget[data-component="${id}"]`),
};
