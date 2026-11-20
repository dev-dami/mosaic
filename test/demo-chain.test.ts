import { describe, expect, test } from "bun:test";
import { agentsSite } from "../providers/agents";
import { announcerSite } from "../providers/announcer";
import { issuesSite } from "../providers/issues";
import type { SiteDefinition } from "../providers/site";
import { videosSite } from "../providers/videos";
import { autoBinding, capKey, parseOutcome, type CapRef } from "../src/host/doc";
import { planWorkspace } from "../src/host/entry/plan";

// The demo story in docs/demo-script.md: comments → issue → agent → post → reply. Every value
// must flow by name alone. The outcome names the project, so nothing is typed by hand.
const OUTCOME = "Fix the bug in Mosaic from my comments and post the fix";
const sites = [videosSite, issuesSite, agentsSite, announcerSite];
const originOf = (d: SiteDefinition) => `http://localhost:${d.port}`;
const refs: CapRef[] = sites.flatMap((d, ci) =>
  d.capabilities.map(({ run: _run, ...cap }, i) => ({ key: capKey(originOf(d), cap.id), origin: originOf(d), siteName: d.name, cap, order: ci * 100 + i })),
);
const ref = (d: SiteDefinition, id: string) => refs.find((r) => r.key === capKey(originOf(d), id))!;
const docProps = { project: parseOutcome(OUTCOME).project ?? "", version: "" };
const bound = (d: SiteDefinition, id: string, field: string) => {
  const b = autoBinding(ref(d, id), field, refs, docProps);
  if (!b) return null;
  return b.kind === "prop" ? `prop:${b.key}` : `${b.kind}:${b.cap.split("#")[1]}.${b.field}`;
};
const run = (d: SiteDefinition, id: string, input: unknown) => d.capabilities.find((c) => c.id === id)!.run(input) as Record<string, string>;

describe("demo chain", () => {
  test("every input of the story binds by name", () => {
    expect(bound(issuesSite, "preview-issue", "title")).toBe("output:find-bug-reports.title");
    expect(bound(issuesSite, "preview-issue", "body")).toBe("output:find-bug-reports.body");
    expect(bound(issuesSite, "file-bug", "title")).toBe("mirror:preview-issue.title");
    expect(bound(issuesSite, "file-bug", "body")).toBe("mirror:preview-issue.body");
    expect(bound(agentsSite, "plan-fix", "issue")).toBe("output:preview-issue.issue");
    expect(bound(agentsSite, "send-agent", "task")).toBe("output:plan-fix.task");
    expect(bound(agentsSite, "send-agent", "branch")).toBe("output:plan-fix.branch");
    expect(bound(announcerSite, "draft-announcement", "project")).toBe("prop:project");
    expect(bound(announcerSite, "draft-announcement", "version")).toBe("output:preview-issue.version");
    expect(bound(announcerSite, "draft-announcement", "notes")).toBe("output:plan-fix.summary");
    expect(bound(announcerSite, "schedule-announcement", "text")).toBe("output:draft-announcement.text");
    expect(bound(videosSite, "reply-to-comment", "comment_id")).toBe("output:find-bug-reports.comment_id");
    expect(bound(videosSite, "reply-to-comment", "reply")).toBe("output:plan-fix.reply");
  });

  test("the outcome names the project", () => {
    expect(parseOutcome(OUTCOME).project).toBe("Mosaic");
  });

  test("the outcome keeps every step and orders the sites as the story goes", () => {
    const plan = planWorkspace({ outcome: OUTCOME, refs, siteOrder: sites.map(originOf) });
    expect(plan.hidden.size).toBe(0);
    expect(plan.siteOrder).toEqual(sites.map(originOf));
  });

  test("the bug report carries through to the post and the reply", () => {
    const found = run(videosSite, "find-bug-reports", { video: "Building Mosaic in a weekend" });
    expect(found).toMatchObject({ title: "Connect button does nothing on Safari", comment_id: "c-2042" });
    const preview = run(issuesSite, "preview-issue", { title: found.title, body: found.body });
    expect(preview.issue).toContain("## #43 Connect button does nothing on Safari");
    const plan = run(agentsSite, "plan-fix", { issue: preview.issue });
    expect(plan.branch).toBe("fix/connect-button-safari");
    expect(plan.summary).toContain("#43");
    expect(plan.reply).toContain("in v1.0.1");
    const post = run(announcerSite, "draft-announcement", { project: "Mosaic", version: preview.version, notes: plan.summary });
    expect(post.text).toStartWith("Introducing Mosaic v1.0.1.");
  });
});
