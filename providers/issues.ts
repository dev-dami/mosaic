import { serveSite, type SiteDefinition } from "./site";

// Patchbay: a fictional issue tracker for code. "Preview issue" shows the issue as it would be
// filed, with the milestone it lands in; "File bug" opens it. Both take title and body, so the
// write files exactly what was previewed.

type Issue = { number: number; title: string; body: string; label: string; milestone: string; opened: string };

const REPO = "weekend/mosaic";
const MILESTONE = "v1.0.1";
const LABELS = ["bug", "ui", "docs", "enhancement"];

const issues: Issue[] = [
  { number: 42, title: "Explain MOSAIC_HOSTS in the README", body: "New site authors miss it.", label: "docs", milestone: MILESTONE, opened: "2026-11-16" },
  { number: 41, title: "Approval sheet should keep its size between writes", body: "It resizes on every open.", label: "ui", milestone: MILESTONE, opened: "2026-11-13" },
  { number: 40, title: "Wires overlap the step chips on narrow screens", body: "Below 900px wide.", label: "ui", milestone: "v1.1", opened: "2026-11-11" },
];

const nextNumber = () => Math.max(...issues.map((i) => i.number)) + 1;

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/** Open issues that share two or more words with the title. */
function similarTo(title: string): string {
  const mine = words(title);
  const hits = issues.filter((i) => [...words(i.title)].filter((w) => mine.has(w)).length >= 2);
  return hits.length ? hits.map((i) => `#${i.number} ${i.title}`).join("; ") : `None of the ${issues.length} open issues look like this one.`;
}

function render(number: number, title: string, body: string, label: string): string {
  return `## #${number} ${title}\n\n${body}\n\n- Label: ${label}\n- Milestone: ${MILESTONE}\n- Repository: ${REPO}`;
}

export const issuesSite: SiteDefinition = {
  name: "Patchbay",
  description: "A fictional issue tracker for code. It lists, previews and files issues on your repositories.",
  port: 4106,
  look: { scheme: "light", accent: "#0f9f7a", font: "mono" },
  capabilities: [
    {
      id: "list-issues",
      title: "List issues",
      description: `List the open issues on ${REPO}, newest first.`,
      side_effects: "read",
      input_schema: { type: "object", properties: {} },
      output_schema: {
        type: "object",
        properties: {
          repository: { type: "string" },
          open: {
            type: "array",
            items: {
              type: "object",
              properties: { number: { type: "string" }, title: { type: "string" }, label: { type: "string" }, milestone: { type: "string" }, opened: { type: "string" } },
            },
          },
        },
      },
      run: () => ({
        repository: REPO,
        open: issues.map((i) => ({ number: `#${i.number}`, title: i.title, label: i.label, milestone: i.milestone, opened: i.opened })),
      }),
    },
    {
      id: "preview-issue",
      title: "Preview issue",
      description: "Show an issue as it would be filed, with its milestone and any similar open issues. Files nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["title", "body"],
        properties: {
          title: { type: "string", title: "Title" },
          body: { type: "string", title: "Description", "x-mosaic-widget": "textarea" },
        },
      },
      output_schema: {
        type: "object",
        properties: {
          issue: { type: "string", description: "The issue as it would be filed, in markdown." },
          version: { type: "string", description: "The milestone the issue lands in." },
          similar: { type: "string" },
        },
      },
      run: (input: { title: string; body: string }) => ({
        issue: render(nextNumber(), input.title, input.body, "bug"),
        version: MILESTONE,
        similar: similarTo(input.title),
      }),
    },
    {
      id: "file-bug",
      title: "File bug",
      description: `Open an issue on ${REPO}.`,
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["title", "body"],
        properties: {
          title: { type: "string", title: "Title" },
          body: { type: "string", title: "Description", "x-mosaic-widget": "textarea" },
          label: { type: "string", title: "Label", enum: LABELS, default: "bug" },
        },
      },
      output_schema: {
        type: "object",
        properties: { number: { type: "integer" }, url: { type: "string" }, milestone: { type: "string" }, opened_at: { type: "string" } },
      },
      run: (input: { title: string; body: string; label?: string }) => {
        const issue: Issue = { number: nextNumber(), title: input.title, body: input.body, label: input.label ?? "bug", milestone: MILESTONE, opened: new Date().toISOString().slice(0, 10) };
        issues.unshift(issue);
        return { number: issue.number, url: `/${REPO}/issues/${issue.number}`, milestone: issue.milestone, opened_at: new Date().toISOString() };
      },
    },
  ],
};

if (import.meta.main) serveSite(issuesSite);
