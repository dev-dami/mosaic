// The learner that looks: Claude sees a screenshot of the site and the reduced page snapshots, and
// writes the skills as browser step scripts. The output is checked (skillProblem) and every read is
// run before Scout offers it, so a wrong script is dropped, not served.
// Credentials come from the environment (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant` profile).
import Anthropic from "@anthropic-ai/sdk";
import type { Observation } from "./observe";
import type { Skill } from "./skill";

export const CLAUDE_MODEL = "claude-opus-5-5";

const STEP = {
  type: "object",
  additionalProperties: false,
  required: ["op", "selector", "value", "url", "field", "kind", "columns"],
  properties: {
    op: { type: "string", enum: ["goto", "fill", "check", "click", "extract"] },
    selector: { type: "string" },
    value: { type: "string" },
    url: { type: "string" },
    field: { type: "string" },
    kind: { type: "string", enum: ["text", "list", "table", "url", ""] },
    columns: { type: "array", items: { type: "string" } },
  },
};

/** The structured output Claude writes: skills in the same flat shape the rules learner drafts. */
export const SKILLS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skills"],
  properties: {
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "side_effects", "fields", "steps"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          side_effects: { type: "string", enum: ["read", "write"] },
          fields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "label", "type", "required", "example"],
              properties: {
                name: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: ["string", "text", "boolean"] },
                required: { type: "boolean" },
                example: { type: "string" },
              },
            },
          },
          steps: { type: "array", items: STEP },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You are Scout, the agent inside Mosaic. Mosaic builds a workspace from what websites can do. This site publishes nothing for Mosaic, so you write its skills: each skill is one useful thing a person could do on the site, written as a short browser script that Scout replays.

You get a screenshot of the first page, a JSON list of the pages Scout visited (their forms, tables and lists, each with a CSS selector), and a first draft from a simple rule-based learner. Improve the draft: give skills clear verb-first titles a person would search for, merge duplicates, drop skills nobody would want, and add what the draft missed.

Script rules:
- The first step is always goto with a path on this site. Write {{field}} for a value the person gives, for example /thread/{{thread_id}}.
- Use only selectors from the snapshot. Never invent one.
- click waits for the next page. extract reads into an output field: kind text (one element), list (each element matching the selector), table (rows of a table), or url (the page address; selector empty).
- For a table extract, columns lists the header cells of that table exactly as the snapshot gives them; each row comes back keyed by them. columns is an empty list for every other step.
- Other unused step properties are empty strings.
- side_effects is "write" when the skill changes anything on the site (posts, saves, sends, deletes); otherwise "read".
- ids are lowercase words joined by hyphens. Input field names and extract output fields are lowercase words joined by underscores.
- For a field that comes from a path segment, set example to a value seen in the snapshot, so Scout can try the read.
- Descriptions say in one sentence what the skill does on the site and, for writes, what it changes.`;

/** Ask Claude for skills. Throws when Claude declines or returns nothing usable. */
export async function learnWithClaude(obs: Observation, draft: Skill[]): Promise<Skill[]> {
  const client = new Anthropic();
  const { screenshot, ...pages } = obs;
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: SKILLS_SCHEMA } },
    system: INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") } },
          { type: "text", text: `Site: ${obs.origin} (${obs.name})\n\nPages:\n${JSON.stringify(pages.pages, null, 1)}\n\nDraft skills:\n${JSON.stringify(draft, null, 1)}` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude declined to learn this site${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`);
  if (response.stop_reason === "max_tokens") throw new Error("Claude ran out of room while writing skills");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { skills: Skill[] };
  return parsed.skills;
}

/** True when the environment holds Claude credentials. */
export const hasClaudeCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
