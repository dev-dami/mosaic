import { serveSite, type SiteDefinition } from "./site";

const BETA_PAGE = "# Getting started\n\nInstall the 0.9 beta.\n\n> The beta API may change before 1.0.";

const pages = new Map<string, { revision: number; body: string }>([["docs/getting-started.md", { revision: 1, body: BETA_PAGE }]]);

function proposedBody(version: string, summary: string): string {
  // Release notes often start with their own heading; the page already has one.
  const changes = summary.replace(/^#{1,6}\s.*\n+/, "").trim();
  return `# Getting started\n\nInstall ${version}.\n\n## What changed in ${version}\n\n${changes}`;
}

export const docsSite: SiteDefinition = {
  name: "Pagewright",
  description: "A fictional documentation host. It previews and applies documentation updates for a project.",
  port: 4101,
  look: { scheme: "light", accent: "#1d7a4e", font: "serif" },
  capabilities: [
    {
      id: "preview-docs-update",
      title: "Preview docs update",
      description: "Show the documentation change a release needs, without changing anything.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["version", "summary"],
        properties: {
          version: { type: "string", title: "Version", default: "v1.0" },
          summary: { type: "string", title: "What changed", "x-mosaic-widget": "textarea" },
        },
      },
      output_schema: {
        type: "object",
        properties: { path: { type: "string" }, before: { type: "string" }, after: { type: "string" } },
      },
      run: (input: { version: string; summary: string }) => {
        const path = "docs/getting-started.md";
        return { path, before: pages.get(path)?.body ?? "", after: proposedBody(input.version, input.summary) };
      },
    },
    {
      id: "apply-docs-update",
      title: "Apply docs update",
      description: "Publish the documentation change for a release.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["version", "summary"],
        properties: {
          version: { type: "string", title: "Version", default: "v1.0" },
          summary: { type: "string", title: "What changed", "x-mosaic-widget": "textarea" },
        },
      },
      output_schema: {
        type: "object",
        properties: { path: { type: "string" }, revision: { type: "integer" }, url: { type: "string" } },
      },
      run: (input: { version: string; summary: string }) => {
        const path = "docs/getting-started.md";
        const revision = (pages.get(path)?.revision ?? 0) + 1;
        pages.set(path, { revision, body: proposedBody(input.version, input.summary) });
        return { path, revision, url: `/${path}?rev=${revision}` };
      },
    },
  ],
};

if (import.meta.main) serveSite(docsSite);
