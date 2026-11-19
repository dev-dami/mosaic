import { serveSite, type SiteDefinition } from "./site";

type Release = { version: string; notes: string; published_at: string };
const releases: Release[] = [{ version: "v0.9.0", notes: "Public beta.", published_at: "2026-10-01T12:00:00.000Z" }];

function changelog(version: string, highlights: string[]): string {
  return `## ${version}\n\n${highlights.map((h) => `- ${h}`).join("\n")}`;
}

export const releasesSite: SiteDefinition = {
  name: "Tagforge",
  description: "A fictional release host. It drafts changelogs and publishes releases.",
  look: { scheme: "dark", accent: "#9b7bff", font: "mono" },
  port: 4102,
  capabilities: [
    {
      id: "list-releases",
      title: "List releases",
      description: "List the published releases, newest first.",
      side_effects: "read",
      input_schema: { type: "object", properties: {} },
      output_schema: { type: "object", properties: { releases: { type: "array" } } },
      run: () => ({ releases }),
    },
    {
      id: "draft-changelog",
      title: "Draft changelog",
      description: "Write release notes from a list of highlights. Publishes nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["version", "highlights"],
        properties: {
          version: { type: "string", title: "Version", default: "v1.0" },
          highlights: { type: "array", title: "Highlights (one per line)", items: { type: "string" }, minItems: 1 },
        },
      },
      output_schema: { type: "object", properties: { notes: { type: "string" } } },
      run: (input: { version: string; highlights: string[] }) => ({ notes: changelog(input.version, input.highlights) }),
    },
    {
      id: "publish-release",
      title: "Publish release",
      description: "Publish a release with its notes.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["version", "notes"],
        properties: {
          version: { type: "string", title: "Version", default: "v1.0" },
          notes: { type: "string", title: "Release notes", "x-mosaic-widget": "textarea" },
          prerelease: { type: "boolean", title: "Pre-release", default: false },
        },
      },
      output_schema: {
        type: "object",
        properties: { version: { type: "string" }, url: { type: "string" }, published_at: { type: "string" } },
      },
      run: (input: { version: string; notes: string }) => {
        const release = { version: input.version, notes: input.notes, published_at: new Date().toISOString() };
        releases.unshift(release);
        return { version: release.version, url: `/releases/${encodeURIComponent(release.version)}`, published_at: release.published_at };
      },
    },
  ],
};

if (import.meta.main) serveSite(releasesSite);
