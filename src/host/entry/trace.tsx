// The staged checks of a connection, in words and marks. The store reports stages as data
// (state/types.ts); this file owns how they read. All four checks are always listed, so the
// person sees what is still to come, and each says exactly what was checked.
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { MANIFEST_PATH } from "../../protocol";
import { hostOf } from "../doc";
import type { ConnectStage, Trace } from "../state";

export type RowState = "todo" | "doing" | "done" | "failed";
export type CheckRow = { stage: ConnectStage; state: RowState; title: string; detail: string };

const ORDER: ConnectStage[] = ["fetch", "verify", "bridge", "build"];

/** What went wrong, in the person's words: a headline and what to do about it. */
export type Refusal = { stage: ConnectStage; headline: string; help: string; raw?: string };

export function refusalOf(t: Trace): Refusal | null {
  const failed = t.stages.find((s) => s.state === "failed" && s.stage !== "build");
  if (!failed) return null;
  const host = hostOf(t.origin);
  const raw = failed.detail ?? "";
  if (failed.stage === "bridge") {
    if (/does not accept|not allowed|host_not_allowed/i.test(raw))
      return { stage: "bridge", headline: `${host} refused this Mosaic`, help: `Its bridge only answers the hosts it lists, and ${location.host} isn't one of them. Nothing was run. Ask the site to allow this origin.`, raw };
    return { stage: "bridge", headline: `${host}'s bridge didn't answer`, help: "The manifest was fine, but the site's own page never replied. Check that the site is up, then try again.", raw };
  }
  if (/names origin/i.test(raw)) return { stage: "verify", headline: `${host} isn't allowed`, help: "Its manifest names a different origin than the one that served it, so Mosaic won't use it.", raw };
  if (/does not match capabilities/i.test(raw)) return { stage: "verify", headline: `${host}'s manifest isn't valid`, help: "It doesn't match the capabilities/0 format. The site needs to fix its manifest.", raw };
  if (/bridge must be/i.test(raw)) return { stage: "verify", headline: `${host} isn't allowed`, help: "Its manifest points the bridge at another origin. A bridge must live on the site's own origin.", raw };
  if (/HTTP \d+/.test(raw)) return { stage: "fetch", headline: `${host} has no manifest`, help: `Nothing at ${host}${MANIFEST_PATH} (${raw.match(/HTTP \d+/)![0]}). Check the URL and try again.`, raw };
  return { stage: "fetch", headline: `Can't reach ${host}`, help: "Check the URL and try again.", raw };
}

export function checkRows(t: Trace): CheckRow[] {
  const host = hostOf(t.origin);
  const name = t.siteName ?? host;
  const refusal = refusalOf(t);
  const seen = new Map(t.stages.map((s) => [s.stage, s]));
  // A manifest problem is reported on the fetch stage by the store; show it on the check it broke.
  if (refusal?.stage === "verify" && seen.get("fetch")?.state === "failed") {
    seen.set("fetch", { stage: "fetch", state: "done" });
    seen.set("verify", { stage: "verify", state: "failed" });
  }
  let stopped = false;
  return ORDER.map((stage) => {
    const s = seen.get(stage);
    const state: RowState = stopped ? "todo" : (s?.state ?? "todo");
    if (state === "failed" && stage !== "build") stopped = true;
    const writes = t.writes ?? 0;
    switch (stage) {
      case "fetch":
        return { stage, state, title: state === "doing" ? "Reading the manifest" : state === "failed" ? "Couldn't read the manifest" : "Read the manifest", detail: `${host}${MANIFEST_PATH}` };
      case "verify":
        return {
          stage,
          state,
          title: state === "failed" ? "Not bound to its origin" : "Bound to its origin",
          detail: state === "done" ? `Names ${host}, the origin that served it. ${t.capabilities ?? 0} capabilities, ${writes} ${writes === 1 ? "changes" : "change"} the site.` : `The manifest must name ${host}`,
        };
      case "bridge":
        return {
          stage,
          state,
          title: state === "doing" ? "Waiting for the bridge" : state === "failed" ? "Bridge refused" : "Bridge answered",
          detail: state === "done" ? `${name}'s own page on ${host} replied. Changes are approved there.` : `${name}'s own page, on ${host}`,
        };
      case "build":
        return {
          stage,
          state: state === "failed" ? "failed" : state,
          title: state === "failed" ? "Mosaic's build changed" : "Mosaic unchanged",
          detail: t.build ? (t.buildSame ? `Build ${t.build}, same as when this page loaded` : `Build is now ${t.build}, not what this page loaded`) : "Source fingerprint checked again",
        };
    }
  });
}

export const isDone = (t: Trace) => t.stages.some((s) => s.stage === "bridge" && s.state === "done");
export const isRunning = (t: Trace) => !refusalOf(t) && !isDone(t);

/** The checklist. `compact` drops details (used in a source's popover). */
export function Checklist({ trace, compact = false }: { trace: Trace; compact?: boolean }) {
  return (
    <ol className={`checks ${compact ? "compact" : ""}`} aria-label="Connection checks">
      {checkRows(trace).map((r) => (
        <li key={r.stage} className={`check ${r.state}`}>
          <span className="check-mark" aria-hidden="true">
            {r.state === "done" ? <CheckIcon weight="bold" /> : r.state === "failed" ? <XIcon weight="bold" /> : null}
          </span>
          <span className="check-text">
            <span className="check-title">{r.title}</span>
            {!compact && <span className="check-detail">{r.detail}</span>}
          </span>
          <span className="sr-only">{r.state === "todo" ? "not started" : r.state === "doing" ? "in progress" : r.state}</span>
        </li>
      ))}
    </ol>
  );
}
