// The host's side of Scout, Mosaic's agent for sites that publish no manifest. Mosaic asks Scout to
// learn a site; Scout serves what it learned as an ordinary Mosaic site on its own origin, and the
// host connects that origin like any other. Owner: entry (connect flow).
//
// Trust: a learned site is not published by the site it drives. Everywhere it shows, it carries the
// AgentTag, and its writes are approved on Scout's sheet, which says so.
import { RobotIcon } from "@phosphor-icons/react";
import type { Site } from "../protocol";
import { hostOf } from "./doc";

/** A saved template, as Scout lists it. */
export type Template = {
  id: string;
  name: string;
  /** The site Scout drives. */
  target: string;
  /** Where Scout serves the learned capabilities. Connect this. */
  origin: string;
  learned_by: string;
  learned_at: string;
  skills: { title: string; side_effects: "read" | "write"; verified: boolean }[];
};

async function call<T>(agent: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(agent + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(String((body as { error?: string }).error ?? `HTTP ${res.status}`));
  return body as T;
}

export const scout = {
  learn: (agent: string, url: string) => call<Template>(agent, "/learn", { method: "POST", body: JSON.stringify({ url }), signal: AbortSignal.timeout(120_000) }),
  templates: (agent: string) => call<Template[]>(agent, "/templates", { signal: AbortSignal.timeout(5_000) }),
  adapter: (agent: string, id: string) => call<unknown>(agent, `/templates/${encodeURIComponent(id)}`),
  import: (agent: string, adapter: unknown) => call<Template>(agent, "/templates", { method: "POST", body: JSON.stringify(adapter) }),
};

/** "rules" or a model id, said plainly. */
export const learnerName = (by: string) => (by === "rules" ? "rules (no model)" : by);

/** Marks a site an agent runs. Dashed, like every other thing in Mosaic that a site did not publish. */
export function AgentTag({ site, compact }: { site: Site; compact?: boolean }) {
  const agent = site.site.agent;
  if (!agent) return null;
  const drives = hostOf(agent.drives);
  return (
    <span className="agent-tag" title={`${agent.name} learned these from ${drives}'s pages (${learnerName(agent.learned_by)}) and performs them in a browser. ${drives} did not publish them. Changes are approved on ${agent.name}'s sheet.`}>
      <RobotIcon weight="bold" aria-hidden="true" />
      {compact ? agent.name : `${agent.name} · drives ${drives}`}
    </span>
  );
}
