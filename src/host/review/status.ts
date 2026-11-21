// One word for where a write stands, shared by the dock, the cards, the receipts and the toasts.
import type { CapRef } from "../doc";
import type { Run, State } from "../state";

/**
 * `unknown`: the site may have done it (its window or the site went away mid-action). Never offered
 * again: the person checks the site. `not_started`: nothing was sent, so asking again is safe.
 */
export type WriteStatus = "idle" | "running" | "waiting" | "done" | "denied" | "failed" | "unknown" | "not_started";

export function writeStatus(state: State, r: CapRef): WriteStatus {
  const run: Run = state.runs[r.key] ?? { status: "idle" };
  if (run.status === "running") return state.confirming === r.origin || state.asking === r.origin ? "waiting" : "running";
  if (run.status === "error") return run.denied ? "denied" : run.unknown ? "unknown" : run.notStarted ? "not_started" : "failed";
  return run.status;
}

/** Paths a write returned on the site's own origin (for example /releases/v1.0), as absolute links. */
export function resultLinks(output: unknown, origin: string): { key: string; path: string; href: string }[] {
  if (!output || typeof output !== "object") return [];
  return Object.entries(output as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].startsWith("/") && !e[1].startsWith("//"))
    .map(([key, path]) => ({ key, path, href: new URL(path, origin).href }));
}
