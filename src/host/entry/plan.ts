// Area B "entry" owns this file. It is the hook through which the outcome sentence picks and
// orders the runbook's steps. The shared model (state/model.ts) calls it with a fixed signature;
// keep the signature, change the logic. Must stay pure and deterministic: no model, no network.
//
// Today it keeps every capability and the dependency order. The outcome-driven plan from
// design/outcome-workspace (src/workspace.ts there: keyword match of the outcome against each
// capability's title and description, plus anything an in-plan step reads from) belongs here.
import type { CapKey, CapRef } from "../doc";

export type PlanInput = {
  /** The outcome sentence as typed. */
  outcome: string;
  /** Every capability of every connected site, in connection order. */
  refs: CapRef[];
  /** Origins in data-dependency order (a site that reads another's output comes after it). */
  siteOrder: string[];
};

export type Plan = {
  /** Origins in the order their steps appear. Must contain each origin of `siteOrder` exactly once. */
  siteOrder: string[];
  /** Capabilities the outcome does not need. They stay connected but get no step block. */
  hidden: Set<CapKey>;
};

export function planWorkspace(input: PlanInput): Plan {
  return { siteOrder: input.siteOrder, hidden: new Set() };
}
