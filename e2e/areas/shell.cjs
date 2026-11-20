// Selectors shared by every area. Owner: foundation.
// Contract: every capability of a connected site renders exactly one element with class `cap`,
// `data-origin` and `data-capability` (reads in the runbook, writes in the review area), visible
// or not. The build badge carries data-testid="build" and gets class `build same` after a
// connection that left Mosaic's fingerprint unchanged.
// A port means a local site; a full URL (a deployed site) is used as it is.
const origin = (port) => (typeof port === "string" ? port : `http://localhost:${port}`);

module.exports = {
  origin,
  capabilityCount: (page, port) => page.locator(`.cap[data-origin="${origin(port)}"]`).count(),
  buildBadge: (page) => page.getByTestId("build"),
  buildSame: (page) => page.locator(".build.same"),
};
