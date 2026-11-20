import { serveSite, type SiteDefinition } from "./site";

let scheduled = 0;

/** Release notes often open with a version heading; a post reads better without it. */
const body = (notes: string) => notes.replace(/^#{1,6}\s.*\n+/, "").trim();

export const announcerSite: SiteDefinition = {
  name: "Loudhailer",
  description: "A fictional announcement service. It drafts and schedules launch posts.",
  port: 4103,
  look: { scheme: "light", accent: "#e8563a", font: "rounded" },
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
        const opener =
          input.tone === "excited"
            ? `${input.project} ${input.version} is here!`
            : input.tone === "formal"
              ? `We are pleased to announce ${input.project} ${input.version}.`
              : `Introducing ${input.project} ${input.version}.`;
        return { text: `${opener}\n\n${body(input.notes)}` };
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
          post_at: { type: "string", title: "Post at", description: "An ISO 8601 date and time, such as 2026-12-01T09:00:00Z. Leave empty to post now." },
        },
      },
      output_schema: {
        type: "object",
        properties: { id: { type: "string" }, posts_at: { type: "string" }, url: { type: "string" } },
      },
      run: (input: { text: string; post_at?: string }) => {
        scheduled += 1;
        const postsAt = new Date(input.post_at ?? Date.now()).toISOString();
        const id = `post-${scheduled}`;
        return { id, posts_at: postsAt, url: `/posts/${id}` };
      },
    },
  ],
};

if (import.meta.main) serveSite(announcerSite);
