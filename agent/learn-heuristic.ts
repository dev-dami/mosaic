// The learner that needs no model: every table becomes a read, every list on a page with an id in
// its path becomes a read, every GET form becomes a search, and every POST form becomes a write.
// It is what Scout uses when no Claude credentials are set, and the floor the model learner must beat.
// Table reads carry the table's header cells as columns, so their output schema lists each row key.
import { pathPattern, type FormSnap, type Observation, type PageSnap } from "./observe";
import { fieldKey, slug, step, type Skill, type SkillField, type Step } from "./skill";

/** "/thread/12" -> url "/thread/{{thread_id}}" and a thread_id field with example "12". */
function routeOf(path: string): { url: string; params: SkillField[] } {
  const params: SkillField[] = [];
  const parts = new URL(path, "http://x").pathname.split("/");
  const url = parts
    .map((seg, i) => {
      if (!/^\d+$/.test(seg)) return seg;
      const name = `${fieldKey(parts[i - 1] || "item")}_id`;
      params.push({ name, label: `${(parts[i - 1] || "item").replace(/s$/, "")} id`.replace(/^./, (c) => c.toUpperCase()), type: "string", required: true, example: seg });
      return `{{${name}}}`;
    })
    .join("/");
  return { url: url + new URL(path, "http://x").search, params };
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function formFields(form: FormSnap): { fields: SkillField[]; steps: Step[] } {
  const fields: SkillField[] = [];
  const steps: Step[] = [];
  for (const f of form.fields) {
    const name = fieldKey(f.name);
    const boolean = f.type === "checkbox";
    fields.push({ name, label: cap(f.label || f.name), type: boolean ? "boolean" : f.type === "textarea" ? "text" : "string", required: f.required, example: "" });
    steps.push(step({ op: boolean ? "check" : "fill", selector: f.selector, value: `{{${name}}}` }));
  }
  return { fields, steps };
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = slug(base);
  if (!/^[a-z]/.test(id)) id = `do-${id}`;
  for (let n = 2; taken.has(id); n++) id = `${slug(base)}-${n}`;
  taken.add(id);
  return id;
}

export function learnHeuristic(obs: Observation): Skill[] {
  const host = new URL(obs.origin).host;
  const skills: Skill[] = [];
  const ids = new Set<string>();
  const seenForms = new Set<string>();
  const add = (s: Omit<Skill, "id">, idBase: string) => skills.push({ id: uniqueId(idBase, ids), ...s });

  for (const page of obs.pages) {
    const { url, params } = routeOf(page.path);
    const where = `${host}${pathPattern(new URL(page.path, "http://x").pathname)}`;
    const open = step({ op: "goto", url });

    // A page with an id in its path: read its heading and its main list (a thread and its posts).
    if (params.length) {
      const list = page.lists[0];
      const noun = (params[0]!.name.replace(/_id$/, "") || "item").replace(/_/g, " ");
      add(
        {
          title: `Read ${noun}`,
          description: `Opens a ${noun} page on ${host} and reads its title${list ? ` and its ${list.name || "items"}` : ""}.`,
          side_effects: "read",
          fields: params,
          steps: [open, step({ op: "extract", field: "title", selector: "h1", kind: "text" }), ...(list ? [step({ op: "extract", field: fieldKey(list.name || "items"), selector: list.selector, kind: "list" })] : [])],
        },
        `read-${noun}`,
      );
    } else if (page.tables.length && !page.path.includes("?")) {
      const t = page.tables[0]!;
      const name = t.name || page.h1 || "table";
      add(
        {
          title: `Read ${name}`,
          description: `Opens ${where} and reads the ${name} table (${t.headers.join(", ")}).`,
          side_effects: "read",
          fields: [],
          steps: [open, step({ op: "extract", field: fieldKey(name), selector: t.selector, kind: "table", columns: t.headers })],
        },
        `read-${name}`,
      );
    }

    for (const form of page.forms) {
      if (!form.submit.selector || !form.fields.length) continue;
      // The same search form on every page is one skill; a post form is one skill per kind of page.
      const fieldNames = form.fields.map((f) => f.name).join(",");
      const signature = form.method === "get" ? `get|${fieldNames}` : `${pathPattern(new URL(page.path, "http://x").pathname)}|post|${fieldNames}`;
      if (seenForms.has(signature)) continue;
      seenForms.add(signature);
      const { fields, steps } = formFields(form);
      const label = cap(form.label || form.submit.text || "Submit form");
      if (form.method === "get") {
        add(
          {
            title: label,
            description: `Fills the “${label}” form on ${where}, presses “${form.submit.text || "submit"}” and reads the results table.`,
            side_effects: "read",
            fields: [...params, ...fields],
            // A guess: the results table has the columns of this page's table. The runner fails a
            // table with none of them, so verifying drops a wrong guess instead of serving it.
            steps: [
              open,
              ...steps,
              step({ op: "click", selector: form.submit.selector }),
              step({ op: "extract", field: "results", selector: "table", kind: "table", columns: page.tables[0]?.headers ?? [] }),
            ],
          },
          label,
        );
      } else {
        add(
          {
            title: label.replace(/ this /i, " a "),
            description: `Fills the “${label}” form on ${where} and presses “${form.submit.text || "submit"}”. This posts to ${host}.`,
            side_effects: "write",
            fields: [...params, ...fields],
            steps: [open, ...steps, step({ op: "click", selector: form.submit.selector }), step({ op: "extract", field: "url", kind: "url" }), step({ op: "extract", field: "page_title", selector: "h1", kind: "text" })],
          },
          label.replace(/ this /i, " a "),
        );
      }
    }
  }
  return skills.slice(0, 32);
}

export type { PageSnap };
