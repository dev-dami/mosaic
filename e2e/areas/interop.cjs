// Selectors for the §6 interop stops in the agent runbook (src/host/runbook/turn.tsx) and the
// runtime's contact dialog (src/host/settings/engine-context.tsx). Owner: C12. Change selectors here
// when the UI changes; keep each function's meaning (its comment) the same.

module.exports = {
  /** The latest turn's problem rows (role=alert), filtered by text. */
  problem: (page, text) => page.locator(".agent-turn .agent-step.problem[role=alert]").filter({ hasText: text }),
  /** The latest turn's summary, shown once the turn has settled. */
  summary: (page) => page.locator(".agent-turn .agent-summary"),
  /** The runtime's "Contact <host>?" dialog for a turn's peer call. */
  contactDialog: (page, host) => page.getByRole("dialog", { name: `Contact ${host}?` }),
  /** Any "Contact …?" dialog. */
  anyContactDialog: (page) => page.getByRole("dialog", { name: /^Contact / }),
  /** A button in a contact dialog: "Decline", "Allow" or "Always allow <host>". */
  contactButton: (dialog, name) => dialog.getByRole("button", { name, exact: true }),
};
