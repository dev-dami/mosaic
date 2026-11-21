<img src="assets/logo.svg" width="72" alt="Mosaic logo: four tiles around one missing piece">

# Mosaic

Mosaic is an open agentic website that runs the agent networks of many other websites in your
browser, on your own model key, for one outcome that you type. Every write is approved on the site's
own sheet, on the site's own origin, so the site and not the agent owns consent.

Mosaic is an entry for the Open Agentic Web Challenge. It follows the agentic-web MVP spec, Profile
0.3, and it runs the sponsor's nsdeploy browser runtime. All demo sites are fictional.

## Try it

1. Open the live demo: https://mosaic-host.vercel.app
2. Click **AI model** in the top bar and pick a preset: **Otari** (the default), **OpenAI**,
   **Claude** (Anthropic's Messages API) or **Agent on this computer** (Claude Code or Codex through
   Mosaic Link, no API key). Your key goes only to that router. With no key, Mosaic runs in manual
   mode and plans the steps without a model.
3. Type an outcome, for example **Fix the bug in Mosaic from my comments and post the fix**, and click
   **Run with the agent**. Allow each site when Mosaic asks. Approve each write in the site's own
   window.

To run it on your machine, you need [Bun](https://bun.sh) 1.4 or later:

```sh
bun install
bun run dev        # Mosaic on :4000, demo sites on :4101 to :4107, Scout on :4108, Corkboard on :4109
```

Open http://localhost:4000. `PORT_BASE=8000 bun run dev` moves every port to 8000 and up.

## Models

| Preset | Router | How Mosaic calls it |
|---|---|---|
| Otari | `https://api.otari.ai/api/v1` | The runtime's own client (OpenAI chat format). |
| OpenAI | `https://api.openai.com/v1` | The runtime's own client. |
| Claude | `https://api.anthropic.com` | `src/host/agentic/claude-client.ts`: the official `@anthropic-ai/sdk`, Messages API, from the browser. Thinking is replayed unchanged across tool steps. |
| Agent on this computer | `http://127.0.0.1:4199/v1` | Mosaic Link (`bun run link`, `link/`): drives Claude Code headless with its tools off. Codex and ACP agents need `--enable codex,acp`. See [docs/local-agents.md](docs/local-agents.md). |

The runtime keeps the loop, the consent dialogs and the site approvals in every case. The model only
picks the next step.

## How it works on the sponsor's spec

Mosaic adds no new format. The host and every site publish the files of MVP Profile 0.3, and the
vendored nsdeploy runtime runs them.

```
 Your browser, on the Mosaic page (origin A)                Site (origin B)
 ───────────────────────────────────────────                ───────────────
 nsdeploy runtime (vendor/, unchanged)
   network "mosaic": agents mosaic + composer
   model calls ──▶ your router only (Otari or BYOK)
 0. consent dialog names B, before any request
 1. GET B/agent-manifest.json ───────────────────────────▶ public, CORS *
 2. load network B/<name> by its exact name ─────────────▶ wrong name: fails closed
    (it runs here, on your model, with only project and version as private context)
 3. website_ read: hidden frame B/bridge/action-bridge.html ▶ callerOrigins = Mosaic hosts
 4. website_ write: "Open B to approve" ─▶ window on B ───▶ B's own sheet, 700 ms Approve delay
                                                             POST B/api/capabilities/:id (same origin)
 5. ◀─────────────────────────────── receipt: Published / Denied / Outcome unknown (no retry)
```

What Mosaic adds on top of the runtime (`src/host/agentic/engine.ts`):

- Consent before contact, through the runtime's `onConsent` hook.
- Exact-name binding: `setLink`, then `resolveRemote` with the exact network name. The runtime's own
  link path is off (`onLinkRequired` returns null).
- One link slot for each suggested site, plus four spares for sites you connect by URL. Unbound slots
  are hidden from the model.
- A per-turn budget of 8 remote calls instead of 4. A test pins the runtime method that this needs.
- BYOK profiles through the runtime's `byok.js`, with its localhost cookie mirror cleared, so no local
  site receives the key.

## The demo sites

| Port | Site | What it does |
|---|---|---|
| 4101 | Pagewright | Docs: previews and applies a docs update. |
| 4102 | Tagforge | Releases: drafts a changelog and publishes a release. |
| 4103 | Loudhailer | Posts: drafts and schedules a short launch post. |
| 4104 | Inkpost | Newsletter. Not in the suggestions: it is the site Mosaic has never seen, connected by URL. |
| 4105 | Reelhouse | Videos: lists videos, reads comments, finds bug reports, replies to a comment. |
| 4106 | Patchbay | Code issues: lists, previews and files issues. |
| 4107 | Foreman | Agents on your own servers: plans a fix and sends an agent to make it. |
| 4108 | Scout | Mosaic's agent. It learns sites that publish no manifest (see below). |
| 4109 | Corkboard | A support forum with **no manifest**: plain HTML forms and tables. |

Each port is a different origin, so the browser treats each site as a separate website. Reelhouse,
Patchbay, Foreman and Loudhailer tell one story: a bug report in the comments becomes an issue, an
agent fixes it, a post goes out, and the commenter gets a reply. The video script is in
[docs/demo-script.md](docs/demo-script.md).

Every site comes from one site definition. `providers/agentic.ts` makes its `agent-manifest.json`, its
network file, `links.json` and its bridge manifest. `providers/bridge-actions.ts` registers one nsdeploy
action per capability. To make your own site:

```ts
import { serveSite } from "./providers/site";

serveSite({
  name: "My Site",
  description: "What the site does.",
  port: 4200,
  capabilities: [{
    id: "say-hello",
    title: "Say hello",
    description: "Return a greeting.",
    side_effects: "read",
    input_schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    output_schema: { type: "object", properties: { text: { type: "string" } } },
    run: ({ name }) => ({ text: `Hello, ${name}` }),
  }],
});
```

Run it, then paste its URL into Mosaic. Mosaic needs no change. The top bar says **Mosaic unchanged**
after each connection: it checks a fingerprint of Mosaic's own build.

## Scout: agentify any site

Most sites will never publish agent files. Paste one into Mosaic, for example Corkboard at
`localhost:4109`. Mosaic refuses it and offers **Teach Scout this site**.

1. Scout opens the site in a headless browser and finds its forms, tables and lists.
2. It writes a browser script for each action, with Claude (`claude-opus-5-5`) when credentials are
   set, or with rules.
3. It runs each read to verify it and drops the reads that fail. It never runs a write while it learns.
4. It serves a conformant `agent-manifest.json`, network, `links.json` and action bridge on its own
   origin. The manifest says that Scout drives the site (`x_mosaic.agent`).

Mosaic connects that origin like any other site, with a dashed **Scout** tag. Writes are approved on
Scout's sheet, which says that the site did not publish the action. Scout opens only the origins in
`SCOUT_TARGETS` (loopback only when it is not set), and a browser fence stops every request that
leaves the target. Details: [docs/agents.md](docs/agents.md).

## Recipes

**Copy recipe link** in the palette puts the workspace into one link: the outcome, the network URLs in
order, and Scout's templates. The link carries no key, router, model, input values or results. On any
Mosaic, the link connects each site again, and each site asks for consent again. Links are checked
strictly before anything happens.

## Security rules

- Mosaic contacts a new origin only after you allow it. The dialog names the origin.
- Mosaic runs only the exact network named in the URL. A site's actions load only from its own origin.
- Your key goes only to the router you select. It never goes into a URL, a recipe, a trace or a peer
  request.
- Only `project` and `version` may pass to a peer as private context.
- Writes run only in a window on the site's origin. The runtime's action bridge refuses them anywhere
  else.
- The bridge accepts callers only from the host origins that the site allows (`MOSAIC_HOSTS`), and the
  bridge page sends `frame-ancestors` with the same list.
- The site API accepts calls only from its own origin, so a host page cannot call it directly.
- Every write needs approval on the site's own sheet. The Approve button stays disabled for 700 ms.
- A write with an unknown result shows "Outcome unknown, check the site". Mosaic never retries it.
- The host page allows scripts from the host only. Frames and fetches may reach any https origin, so you
  can connect a new site or use your own router. Consent gates each contact.

Known gaps are in [docs/plan.md](docs/plan.md#known-gaps).

## Spec conformance

[docs/judging.md](docs/judging.md) maps each of the seven interoperability checks in spec §6, each
hard requirement and each judging criterion to the file, test or screen that shows it, with a status.

| §6 check | Status |
|---|---|
| 1. Two-agent network and manifest from an HTTPS host | partly: shown locally, HTTPS after the deploy |
| 2. Default router and BYOK path | partly: BYOK shown, the Otari default needs the visitor's key |
| 3. Internal agent plus a grounded site action | shown |
| 4. Exact named network from a second origin, after approval | shown |
| 5. The peer never gets the key and cannot change the router | partly |
| 6. Private context absent at the peer unless allowed | partly |
| 7. Visible errors for invalid network, cycle, budget, denied origin | partly |

A conformance suite for checks 5 to 7 comes next.

## Run and test

```sh
bun run typecheck
bun run test       # unit tests (the Scout tests need Chromium)
bun run e2e        # browser test of the whole flow (needs Node 24 and a Chromium, set CHROMIUM_PATH if needed)
bun run check      # all three
bun run build:deploy   # the single-file server for Vercel (docs/deploy.md)
```

`E2E_PORT_BASE` moves the e2e ports.

## Where things are

| Path | What it is |
|---|---|
| `vendor/nsdeploy-runtime/` | The nsdeploy browser runtime, unchanged. Served at `/runtime/*`. |
| `src/host/agentic/` | The runtime wrapper (`engine.ts`), Mosaic's own network (`network.ts`), and the action registry mapping (`catalog.ts`). |
| `src/host/settings/` | The AI model dialog, the BYOK store and the consent dialog. |
| `src/host/` | The workspace (React): `entry/`, `runbook/`, `review/` over one store (`state/`). See [docs/design.md](docs/design.md). |
| `providers/` | The site kit (`site.ts`, `agentic.ts`, `bridge-actions.ts`, `sheet.ts`) and the demo sites. |
| `agent/` | Scout: observe, learn, verify, serve, and the target allow list (`targets.ts`). |
| `src/host/recipe.ts` | Recipe links. |
| `docs/` | [Plan](docs/plan.md), [judging map](docs/judging.md), [submission text](docs/submission.md), [video script](docs/demo-script.md), [Scout](docs/agents.md), [deploy](docs/deploy.md), [runtime spike](docs/spike-nsdeploy.md). |

## Credits

- The nsdeploy browser runtime and the agentic-web `agentify-website` skill, by Cognizant AI Lab, under
  the Apache License 2.0. Vendored from [agentic-web](https://github.com/cognizant-ai-labs/agentic-web)
  `skills/agentify-website/runtime/` at commit `0516537`. See `vendor/nsdeploy-runtime/LICENSE` and
  `VENDOR.md`. Upstream runtime: [nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy).
- The spec: the agentic-web Minimum Viable Specification for a Worldwide Agentic Web, MVP Profile 0.3.
- Agent networks use the [Neuro SAN](https://github.com/cognizant-ai-lab/neuro-san) network format.
- Related work: MIT NANDA's [WebAgentica](https://github.com/projnanda/webagentica) packages agents for
  one publisher. Mosaic composes many publishers.

## License

Mosaic is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for the bundled
third-party code.
