// One word for where a write stands, shared by the dock, the cards, the receipts and the toasts.
import type { CapRef } from "../doc";
import type { Run, State } from "../state";

export type WriteStatus = "idle" | "running" | "waiting" | "done" | "denied" | "failed";

export function writeStatus(state: State, r: CapRef): WriteStatus {
  const run: Run = state.runs[r.key] ?? { status: "idle" };
  if (run.status === "running") return state.confirming === r.origin ? "waiting" : "running";
  if (run.status === "error") return run.denied ? "denied" : "failed";
  return run.status;
}

/** Paths a write returned on the site's own origin (for example /releases/v1.0), as absolute links. */
export function resultLinks(output: unknown, origin: string): { key: string; path: string; href: string }[] {
  if (!output || typeof output !== "object") return [];
  return Object.entries(output as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].startsWith("/") && !e[1].startsWith("//"))
    .map(([key, path]) => ({ key, path, href: new URL(path, origin).href }));
}
