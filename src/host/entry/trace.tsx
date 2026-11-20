// The staged checks of a connection, in words and marks. The store reports stages as data
// (state/types.ts); this file owns how they read. All six checks are always listed, so the
// person sees what is still to come, and each says exactly what was checked.
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { hostOf } from "../doc";
import type { ConnectStage, Trace } from "../state";

export type RowState = "todo" | "doing" | "done" | "failed";
export type CheckRow = { stage: ConnectStage; state: RowState; title: string; detail: string };

const ORDER: ConnectStage[] = ["consent", "manifest", "network", "validate", "bridge", "build"];
const MANIFEST = "/agent-manifest.json";

/** What went wrong, in the person's words: a headline and what to do about it. */
export type Refusal = { stage: ConnectStage; headline: string; help: string; raw?: string };

export function refusalOf(t: Trace): Refusal | null {
  const failed = t.stages.find((s) => s.state === "failed" && s.stage !== "build");
  if (!failed) return null;
  const host = hostOf(t.origin);
  const raw = failed.detail ?? "";
  switch (failed.stage) {
    case "consent":
      if (/declined/i.test(raw)) return { stage: "consent", headline: `You declined ${host}`, help: "Nothing was sent to it. Connect again to be asked again.", raw };
      return { stage: "consent", headline: "Mosaic's agent isn't ready", help: "Its runtime did not start, so nothing was sent to the site. Reload and try again.", raw };
    case "manifest":
      if (/HTTP \d+/.test(raw)) return { stage: "manifest", headline: `${host} publishes no agent manifest`, help: `Nothing at ${host}${MANIFEST} (${raw.match(/HTTP \d+/)![0]}). Check the URL and try again.`, raw };
      // A browser hides why a cross-origin fetch failed: the site may be down, or it serves no manifest.
      return { stage: "manifest", headline: `No agent manifest from ${host}`, help: "Mosaic couldn't read one there. The site may be down, or it publishes nothing for agents. Check the URL and try again.", raw };
    case "network":
      if (t.choices?.length) return { stage: "network", headline: `${host} publishes ${t.choices.length} networks`, help: "Pick the one to connect. Mosaic runs only the network you name.", raw };
      if (/No published network named/i.test(raw))
        return { stage: "network", headline: `${host} has no network named "${t.network}"`, help: "Mosaic runs only the exact network you name, never a different one. Nothing was run. Check the name after the slash.", raw };
      return { stage: "network", headline: `${host} publishes no agent network`, help: "Its manifest lists no network to connect.", raw };
    case "validate":
      return { stage: "validate", headline: `${host}'s network isn't valid`, help: "The runtime could not load or check the network it publishes, so Mosaic won't run it. The site needs to fix it.", raw };
    case "bridge":
      if (/callerOrigins|not exposed|lists no actions/i.test(raw))
        return { stage: "bridge", headline: `${host} refused this Mosaic`, help: `Its action bridge only answers the hosts it lists, and ${location.host} isn't one of them. Nothing was run. Ask the site to allow this origin.`, raw };
      return { stage: "bridge", headline: `${host}'s action bridge didn't answer`, help: "The network was fine, but the site's own bridge page never replied. Check that the site is up, then try again.", raw };
    default:
      return { stage: failed.stage, headline: `${host} didn't connect`, help: "Try again.", raw };
  }
}

export function checkRows(t: Trace): CheckRow[] {
  const host = hostOf(t.origin);
  const name = t.siteName ?? host;
  const seen = new Map(t.stages.map((s) => [s.stage, s]));
  let stopped = false;
  return ORDER.map((stage): CheckRow => {
    const s = seen.get(stage);
    const state: RowState = stopped ? "todo" : (s?.state ?? "todo");
    if (state === "failed" && stage !== "build") stopped = true;
    const writes = t.writes ?? 0;
    switch (stage) {
      case "consent":
        return { stage, state, title: state === "doing" ? "Asking you first" : state === "failed" ? "Not allowed" : "You allowed it", detail: `Before any request to ${host}` };
      case "manifest":
        return { stage, state, title: state === "doing" ? "Reading the manifest" : state === "failed" ? "Couldn't read the manifest" : "Read the manifest", detail: `${host}${MANIFEST}` };
      case "network":
        return {
          stage,
          state,
          title: state === "failed" ? (t.choices?.length ? "Pick a network" : "No such network") : "Exact network",
          detail: t.network ? `"${t.network}", exactly as named, or nothing` : "The name after the slash, or the only one published",
        };
      case "validate":
        return { stage, state, title: state === "doing" ? "Checking the network" : state === "failed" ? "Network refused" : "Network checked", detail: `${host}/${t.network ?? "…"} loaded and validated in this browser` };
      case "bridge":
        return {
          stage,
          state,
          title: state === "doing" ? "Waiting for the bridge" : state === "failed" ? "Bridge refused" : "Bridge answered",
          detail:
            state === "done"
              ? `${name}'s own bridge on ${host} listed ${t.capabilities ?? 0} actions, ${writes} ${writes === 1 ? "changes" : "change"} the site. Changes are approved there.`
              : `${name}'s own page, on ${host}`,
        };
      case "build":
        return {
          stage,
          state,
          title: state === "failed" ? "Mosaic's build changed" : stopped ? "Not checked" : "Mosaic unchanged",
          detail: stopped ? "Skipped, because the connection stopped above" : t.build ? (t.buildSame ? `Build ${t.build}, same as when this page loaded` : `Build is now ${t.build}, not what this page loaded`) : "Source fingerprint checked again",
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
