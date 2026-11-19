import { serveSite, type SiteDefinition } from "./site";

let scheduled = 0;

export const announcerSite: SiteDefinition = {
  name: "Demo Announcer",
  description: "A fictional announcement service. It drafts and schedules launch posts.",
  port: 4103,
  capabilities: [
    {
      id: "draft-announcement",
      title: "Draft announcement",
      description: "Write a launch post from a release. Posts nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["project", "version", "notes"],
        properties: {
          project: { type: "string", title: "Project" },
          version: { type: "string", title: "Version", default: "v1.0" },
          notes: { type: "string", title: "Release notes", "x-mosaic-widget": "textarea" },
          tone: { type: "string", title: "Tone", enum: ["plain", "excited", "formal"], default: "plain" },
        },
      },
      output_schema: { type: "object", properties: { text: { type: "string" } } },
      run: (input: { project: string; version: string; notes: string; tone?: string }) => {
        const opener = input.tone === "excited" ? `${input.project} ${input.version} is here!` : `Introducing ${input.project} ${input.version}.`;
        return { text: `${opener}\n\n${input.notes}` };
      },
    },
    {
      id: "schedule-announcement",
      title: "Schedule announcement",
      description: "Schedule a launch post.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", title: "Post", "x-mosaic-widget": "textarea" },
          delay_minutes: { type: "integer", title: "Delay (minutes)", default: 0, minimum: 0 },
        },
      },
      output_schema: { type: "object", properties: { id: { type: "string" }, posts_at: { type: "string" } } },
      run: (input: { text: string; delay_minutes?: number }) => {
        scheduled += 1;
        const postsAt = new Date(Date.now() + (input.delay_minutes ?? 0) * 60_000).toISOString();
        return { id: `post-${scheduled}`, posts_at: postsAt };
      },
    },
  ],
};

if (import.meta.main) serveSite(announcerSite);
