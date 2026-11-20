# Agents: Scout

Most of the web will never publish a Mosaic manifest. Scout is Mosaic's agent for those sites. It
opens a site in a headless browser, looks at what its pages can do, and writes a short browser
script for each thing. It saves the scripts as a **template** and serves them as an ordinary Mosaic
site. Mosaic connects that site like any other. No part of the workspace knows that an agent is
involved, except the labels that tell the person.

## The flow

1. In the palette, the person pastes a URL. The site has no manifest, so Mosaic refuses it as usual.
2. If this Mosaic has an agent (`MOSAIC_AGENT`), the refusal offers **Teach Scout this site**.
3. Scout observes the site (`agent/observe.ts`). It visits up to 8 same-origin pages, one for each
   kind of path, so `/thread/1` and `/thread/2` count as one page. It reduces each page to its forms,
   tables, lists and headings, each with a CSS selector, and takes a screenshot of the first page.
4. Scout learns skills from that observation:
   - **With Claude** (`agent/learn-claude.ts`, model `claude-opus-5-5`). Claude receives the
     screenshot, the snapshots and a rules-based draft. It writes the skills as step scripts with
     structured output. This needs credentials in the environment of Scout: `ANTHROPIC_API_KEY`,
     `ANTHROPIC_AUTH_TOKEN` or an `ant` profile.
   - **With rules** (`agent/learn-heuristic.ts`), when there are no credentials, or if Claude fails.
     Each table becomes a read. Each list on a page with an id in its path becomes a read. Each GET
     form becomes a search, and each POST form becomes a write. An id in the path becomes a field:
     `/thread/12` becomes `/thread/{{thread_id}}`.
5. Scout checks each skill (`skillProblem`), then runs each read with the values it saw while it
   learned. It drops a read that fails. It never runs a write while it learns.
6. Scout saves the template and serves it on its own origin (by default, from port Scout + 2). The
   palette then connects that origin. The person sees "+5 capabilities from Corkboard".

## Step scripts

A skill is a capability plus the steps that perform it:

```json
{
  "id": "reply-to-a-thread",
  "title": "Reply to a thread",
  "side_effects": "write",
  "fields": [{ "name": "thread_id", "label": "Thread id", "type": "string", "required": true, "example": "1" }, "…"],
  "steps": [
    { "op": "goto", "url": "/thread/{{thread_id}}" },
    { "op": "fill", "selector": "#body", "value": "{{body}}" },
    { "op": "click", "selector": "form[aria-label=\"Reply to this thread\"] button" },
    { "op": "extract", "field": "url", "kind": "url" }
  ]
}
```

The operations are `goto`, `fill`, `check`, `click` (it waits for the next page) and `extract` (as
`text`, `list`, `table` or `url`). `{{field}}` takes a value from the input. Each run uses a new
browser context, with no cookies and no stored state. A step that leaves the target's origin stops the
run.

## Templates

A template is a file in the `mosaic-adapter/0` format: the target site, who learned it and when, and
its skills. Scout keeps templates in `.scout/` (set `SCOUT_DIR` to move them) and loads them again
when it starts, on the same ports.

- The palette lists saved templates under **Learned by Scout**, to connect with one click.
- `GET /templates/:id` exports a template. `POST /templates` imports one into any Scout.
- Without `steps`, each skill is a valid capability. A site owner can publish the capabilities part of a
  template as their own manifest, and then no agent is needed.

## Recipes: composable everywhere

**Copy recipe link** in the palette puts the workspace into one link: the outcome and the sites, in
order. A site that Scout learned also carries its template. Opening the link on another Mosaic sets
the outcome, imports the templates into that Mosaic's Scout, and connects each site. Each connection
runs the usual checks. A recipe grants nothing: no inputs, results or approvals travel with it.

So the same unit moves at every level:

| Unit | Format | Who makes it |
|---|---|---|
| Capability | `capabilities/0` manifest | The site |
| Template | `mosaic-adapter/0` (capabilities plus steps) | Scout, for a site that publishes nothing |
| Recipe | `recipe/0` link (outcome, sites, templates) | The person, from any workspace |

## Trust

A learned site is not published by the site that it drives. Mosaic shows this in all places:

- The manifest carries `site.agent` (`name`, `drives`, `learned_by`). The host shows the dashed
  **Scout** tag on the step and in the site details. The tooltip names the site it drives and the
  learner.
- Writes are approved on Scout's sheet, not the site's. The sheet says "Scout will do this in a browser
  on localhost:4109. localhost:4109 did not publish this action". The 700 ms Approve delay and the
  host allow list work as they do for any site.
- Scout accepts calls only from its Mosaic hosts (`MOSAIC_HOSTS`, checked on the Origin header).
- `shortcut:` Scout learns any http(s) target, also private addresses, because the demo sites are on
  localhost. Before Scout runs on a shared server, add an allow list of targets.
- `shortcut:` Scout drives each site with no cookies, so it cannot act inside a person's account.
  Signed-in sites need a per-person browser profile, which is not built.

## Run it

`bun run dev` starts Scout on :4108 and Corkboard on :4109. Corkboard is a fictional support forum
that publishes no manifest. In Mosaic, press Ctrl K, paste `localhost:4109`, and click **Teach Scout
this site**. To learn with Claude, start the dev script with `ANTHROPIC_API_KEY` set.
