// The staged checks of a connection, in words. The store reports stages as data (state/types.ts);
// this file owns how they read.
import { MANIFEST_PATH } from "../../protocol";
import { hostOf } from "../doc";
import type { Trace, TraceStage } from "../state";

export function stageLabel(t: Trace, s: TraceStage): string {
  const host = hostOf(t.origin);
  const name = t.siteName ?? host;
  if (s.state === "failed" && s.stage !== "build") return s.detail ?? (s.stage === "bridge" ? "bridge refused" : "failed");
  switch (s.stage) {
    case "fetch":
      return s.state === "doing" ? `Reading ${host}${MANIFEST_PATH}` : `Read ${host}${MANIFEST_PATH}`;
    case "verify":
      return `Manifest is bound to ${host} · ${t.capabilities ?? 0} capabilities (${t.writes ?? 0} change the site)`;
    case "bridge":
      return s.state === "doing" ? `Opening ${name}'s bridge on its own origin` : `${name}'s bridge answered from ${host}`;
    case "build":
      return t.buildSame ? `Blocks added to the runbook · Mosaic build ${t.build}, no redeploy` : `Blocks added to the runbook · Mosaic build changed to ${t.build} since this page loaded`;
  }
}

export function TraceList({ trace }: { trace: Trace }) {
  return (
    <ol className="trace" aria-label="Connection steps" aria-live="polite">
      {trace.stages.map((s, i) => (
        <li key={i} className={s.state}>
          <span className="trace-mark" aria-hidden="true" />
          {stageLabel(trace, s)}
        </li>
      ))}
    </ol>
  );
}
