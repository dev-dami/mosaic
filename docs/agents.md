# Agents: Scout

Most of the web will never publish agent files. Scout is Mosaic's agent for those sites: it
agentifies a site that publishes nothing. It opens the site in a headless browser, looks at what
its pages can do, and writes a short browser script for each thing. It saves the scripts as a
**template** and serves them on its own origin as a site that conforms to the Open Agentic Web MVP
profile 0.3: an `agent-manifest.json`, a Neuro SAN network, `links.json` and an nsdeploy action
bridge. Any caller's runtime connects that origin like any other site. Only the labels say that an
agent is involved, and they say it everywhere.

## The flow

1. In the palette, the person pastes a URL. The site publishes no `agent-manifest.json`, so Mosaic
   refuses it as usual.
2. If this Mosaic has an agent (`MOSAIC_AGENT`), the refusal offers **Teach Scout this site**.
3. Scout observes the site (`agent/observe.ts`). It visits up to 8 same-origin pages, one for each
   kind of path, so `/thread/1` and `/thread/2` count as one page. It reduces each page to its forms,
   tables, lists and headings, each with a CSS selector, and takes a screenshot of the first page.
4. Scout learns skills from that observation:
   - **With Claude** (`agent/learn-claude.ts`, model `claude-opus-5-5`). Claude receives the
     screenshot, the snapshots and a rules-based draft. It writes the skills as step scripts with
     structured output (`SKILLS_SCHEMA`, the same shape the rules learner drafts). This needs
     credentials in the environment of Scout: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an
     `ant` profile.
   - **With rules** (`agent/learn-heuristic.ts`), when there are no credentials, or if Claude fails.
     Each table becomes a read. Each list on a page with an id in its path becomes a read. Each GET
     form becomes a search, and each POST form becomes a write. An id in the path becomes a field:
     `/thread/12` becomes `/thread/{{thread_id}}`.
5. Scout checks each skill (`skillProblem`), then runs each read with the values it saw while it
   learned (`verifySkills`). It drops a read that fails. It never runs a write while it learns.
6. Scout saves the template and serves it on its own origin (by default, from port Scout + 2). The
   palette then connects that origin. The person sees "+5 capabilities from Corkboard".

## What a served template publishes

`adapterSite` (`agent/skill.ts`) turns a template into a site definition, and `serveSite` publishes
the same files as every Mosaic demo site (`providers/agentic.ts`):

| File | What it holds |
|---|---|
| `agent-manifest.json` | One network, the Otari router, a closed peer policy, `actions.agentTools` (one per skill) and `x_mosaic.agent`: `{ name: "Scout", drives: <target origin>, learned_by: "rules" or the model }` |
| `<slug>.network.json` | The Neuro SAN network: one front agent whose instructions say that Scout performs the tools in a browser on the target, which did not publish them |
| `links.json` | No link slots |
| `bridge/action-bridge.html`, `bridge/agent-manifest.json`, `bridge/bridge-actions.js` | The nsdeploy action bridge: one action per skill. Reads run in a hidden frame, writes in a popup on Scout's origin |

Every input and output schema stays inside the runtime's `checkSchema` subset. Objects list their
properties, arrays their items, and output fields are plain strings, lists of strings or tables.
The runtime checks every result with `validateData` and refuses keys the schema does not list, so a
table read carries its `columns`: each row is an object with exactly those keys. A table with no
known columns returns each row as a list of cell texts. `test/agent.test.ts` learns Corkboard in a
real browser, serves the template and checks all of this, with the runtime's own functions.

To run the agentify-website skill's partner check by hand against a served template:

```sh
node <agentic-web>/skills/agentify-website/scripts/check_partner.mjs http://localhost:4110/corkboard --origin http://localhost:4000
```

The test runs it too when the script is at the path in `CHECK_PARTNER` (default: the probe checkout
in `/tmp`), and expects exit code 0.

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
`text`, `list`, `table` or `url`). A table extract also has `columns`, the header cells of the table.
`{{field}}` takes a value from the input. Each run uses a new browser context, with no cookies and
no stored state. A step that leaves the target's origin stops the run.

## Templates

A template is a file in the `mosaic-adapter/0` format, Scout's private save format: the target
site, who learned it and when, and its skills with their steps. Callers never see it; they see the
agent files above. Scout keeps templates in `.scout/` (set `SCOUT_DIR` to move them) and loads them
again when it starts, on the same ports.

- The palette lists saved templates under **Learned by Scout**, to connect with one click.
- `GET /templates/:id` exports a template. `POST /templates` imports one into any Scout.
- A site owner can take the agent files a served template publishes and serve them from their own
  origin with their own actions, and then no agent is needed.

## Recipes: composable everywhere

**Copy recipe link** in the palette puts the workspace into one link: the outcome and the sites, in
order. A site that Scout learned also carries its template. Opening the link on another Mosaic sets
the outcome, imports the templates into that Mosaic's Scout, and connects each site. Each connection
runs the usual checks. A recipe grants nothing: no inputs, results or approvals travel with it.

So the same unit moves at every level:

| Unit | Format | Who makes it |
|---|---|---|
| Site agent | `agent-manifest.json`, network, `links.json`, action bridge (MVP profile 0.3) | The site, or Scout for a site that publishes nothing |
| Template | `mosaic-adapter/0` (skills plus steps), Scout's private save format | Scout |
| Recipe | `recipe/0` link (outcome, sites, templates) | The person, from any workspace |

## Scout vs nsdeploy native form discovery

nsdeploy can discover a page's native forms by itself (nsdeploy `docs/actions.md`, "Automatic native
form discovery"). That needs the site owner: the agent bundle and its runtime must be served from
the site's own origin, and the owner names the action pages. It turns forms into actions only, all
`write` unless the owner marks one `read`, and reads no tables or lists. Scout works on sites you
do not control. It learns from a screenshot and the DOM, with an LLM or with rules. It names the
skills and their fields, maps ids in paths to inputs (`/thread/{{thread_id}}`), reads tables and
lists as typed outputs, and verifies each read by running it before it serves it. The two meet in
the middle: a site that adopts nsdeploy no longer needs Scout.

## Trust

A learned site is not published by the site that it drives. Mosaic shows this in all places:

- `agent-manifest.json` carries `x_mosaic.agent` (`name`, `drives`, `learned_by`), and the network's
  front agent says so in its instructions. The host shows the dashed **Scout** tag on the step and in
  the site details. The tooltip names the site it drives and the learner.
- Writes are approved on Scout's sheet in the bridge popup, not the site's. The sheet says "Scout will
  do this in a browser on localhost:4109. localhost:4109 did not publish this action". The 700 ms
  Approve delay and the host allow list work as they do for any site.
- Scout accepts calls only from its Mosaic hosts (`MOSAIC_HOSTS`, checked on the Origin header). The
  bridge accepts callers from the same list.
- `shortcut:` Scout learns any http(s) target, also private addresses, because the demo sites are on
  localhost. Before Scout runs on a shared server, add an allow list of targets.
- `shortcut:` Scout drives each site with no cookies, so it cannot act inside a person's account.
  Signed-in sites need a per-person browser profile, which is not built.

## Run it

`bun run dev` starts Scout on :4108 and Corkboard on :4109. Corkboard is a fictional support forum
that publishes no agent files. In Mosaic, press Ctrl K, paste `localhost:4109`, and click **Teach
Scout this site**. To learn with Claude, start the dev script with `ANTHROPIC_API_KEY` set.
