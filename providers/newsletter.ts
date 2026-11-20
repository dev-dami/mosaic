import { serveSite, type SiteDefinition } from "./site";

// A fourth fictional site that is not in the default suggestions. It exists to show the
// "connect a site Mosaic has never seen" moment: its inputs bind to the workspace on arrival.
let issues = 0;

export const newsletterSite: SiteDefinition = {
  name: "Inkpost",
  description: "A fictional newsletter service. It drafts and sends issues to subscribers.",
  port: 4104,
  look: { scheme: "dark", accent: "#3fb5c9", font: "serif" },
  capabilities: [
    {
      id: "draft-issue",
      title: "Draft newsletter issue",
      description: "Write a newsletter issue from release notes. Sends nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["project", "version", "notes"],
        properties: {
          project: { type: "string", title: "Project" },
          version: { type: "string", title: "Version", default: "v1.0" },
          notes: { type: "string", title: "Release notes", "x-mosaic-widget": "textarea" },
        },
      },
      output_schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } } },
      run: (input: { project: string; version: string; notes: string }) => ({
        subject: `${input.project} ${input.version} is out`,
        body: `Hi there,\n\n${input.project} ${input.version} shipped today. Here is what changed:\n\n${input.notes}\n\nThanks for reading.`,
      }),
    },
    {
      id: "send-issue",
      title: "Send newsletter issue",
      description: "Email a newsletter issue about a release to every subscriber.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["subject", "body"],
        properties: {
          subject: { type: "string", title: "Subject" },
          body: { type: "string", title: "Issue", "x-mosaic-widget": "textarea" },
          send_at: { type: "string", title: "Send at", description: "An ISO 8601 date and time, such as 2026-12-01T09:00:00Z. Leave empty to send now." },
        },
      },
      output_schema: { type: "object", properties: { id: { type: "string" }, recipients: { type: "integer" }, url: { type: "string" } } },
      run: () => {
        issues += 1;
        return { id: `issue-${issues}`, recipients: 1240, url: `/issues/${issues}` };
      },
    },
  ],
};

if (import.meta.main) serveSite(newsletterSite);
