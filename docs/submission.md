# Devpost submission: Mosaic

Draft text for the Open Agentic Web Challenge form. Each claim here points to code in this repository
or to a note in [judging.md](judging.md). Items marked `TODO(verify)` are not confirmed yet. Remove
the marks only after you check them.

The form also asks for:

- The video link (public on YouTube, under 2 minutes). Script: [demo-script.md](demo-script.md).
  `TODO(verify): YouTube URL.`
- The Otari account email. The owner fills this field. Do not put it in the repository.
- The live demo URL. `TODO(verify): host URL after the deploy (card C13b).`
- The repository URL. `TODO(verify): the repository must be public before you submit.`

---

## Title

Mosaic

## Tagline

Type one outcome. Mosaic runs the agent networks of several websites in your browser, on your own
model key, and each site approves its own writes.

## Inspiration

The sponsor's examples each agentify one website. A visitor opens the site and talks to that site's
agents. That is the first step. Real work crosses sites. To fix a bug that a viewer reports under a
video, you read the comments on a video site, file an issue on a code site, send a fix to a build
server and post an update on a social site. Today you are the glue between those sites. You copy and
paste, and you check each step yourself.

The MVP spec already has the parts for the next step. A network can link to another site's network by
URL. A peer network runs in the caller's browser on the caller's model. A site action runs on the
site's own origin. We wanted to find out if these parts are enough to compose many publishers into one
workspace, with no code for any one site, and with the site, not the agent, in control of consent.

## What it does

Mosaic is an open agentic website. It publishes its own agent network, and it runs other sites'
networks in your browser.

1. **One outcome, many sites.** You type an outcome, for example "Fix the bug in Mosaic from my
   comments and post the fix". Mosaic's own network (a planner agent `mosaic` and an internal agent
   `composer`) runs in your browser. It calls the published networks of the sites it needs. Each peer
   call is a step in a runbook, with the site's name and origin on a chip. Each `website_` tool call
   shows its input and its output. When text moves from one site to the next, the composer drafts it,
   and the runbook shows that step as Mosaic's own.
2. **The site owns consent.** No write runs on Mosaic's page. A write waits on a card that says
   "Open <site> to approve". Your click opens a window on the site's own origin. There, the site shows
   its own approval sheet, in its own style. The Approve button stays disabled for 700 ms, so a click
   aimed at Mosaic cannot land on it. The receipt comes back as Published, Denied, or "Outcome unknown,
   check the site". Mosaic never retries an unknown outcome.
3. **Consent before contact.** Before Mosaic sends any request to a new origin, a dialog names that
   origin and the request. You can Allow, Always allow (for this session), or Decline. Decline sends
   nothing.
4. **Your key, your router.** The "AI model" dialog stores profiles (router, model, key) with the
   runtime's own `byok.js`. The key goes only to the router you select. The dialog says so. Peer sites
   run on your model and never receive the key. The default router is Otari. With no key, Mosaic runs
   in manual mode: it plans the steps by keyword and makes no model call, so the host never pays for
   inference.
5. **Connect a site Mosaic has never seen.** Paste a site's URL. Mosaic asks for consent, reads the
   site's `agent-manifest.json`, loads the network by its exact name, and adds the site's actions to the
   workspace. Mosaic's source does not change. A badge in the top bar checks a fingerprint of Mosaic's
   build after each connection and says "Mosaic unchanged".
6. **Scout: agentify any site, even one that publishes nothing.** Paste a site with no manifest, and
   Mosaic offers "Teach Scout this site". Scout opens the site in a headless browser, finds its forms,
   tables and lists, and writes a browser script for each action. It runs each read to verify it and
   drops the reads that fail. It never runs a write while it learns. Then it serves a conformant
   manifest, network, `links.json` and action bridge on its own origin. Mosaic connects it like any
   other site, with a dashed "Scout" tag. Scout's own sheet says that the site did not publish the
   action. Scout opens only origins on its target allow list.
7. **Recipes.** "Copy recipe link" puts the whole workspace into one link: the outcome, the network URLs
   in order, and Scout's templates. The link carries no key, router, model, input values or results.
   On any Mosaic, the link connects each site again, and each site asks for consent again.

All demo sites are fictional. Seven publish agent networks: Pagewright (docs), Tagforge (releases),
Loudhailer (posts), Inkpost (newsletter), Reelhouse (videos), Patchbay (code issues) and Foreman (fix
agents on your servers). Corkboard is a support forum that publishes nothing, for Scout.

## How we built it

Mosaic uses the sponsor's stack. It does not add a parallel standard.

- **Runtime.** We vendor the nsdeploy browser runtime from the agentic-web `agentify-website` skill
  (Apache-2.0) into `vendor/nsdeploy-runtime/`, unchanged. A diff check keeps it unchanged. The host and
  every site serve it at `/runtime/*`. Mosaic uses `Engine` without the runtime's UI. A small wrapper
  (`src/host/agentic/engine.ts`) adds the hooks and the rules below.
- **`agent-manifest.json`.** The host and every site publish one. It has `networks` (name, front_man,
  hocon), `llm_router` (Otari), `allowed_peers`, `peer_policy` (closed), `actions` (bridge page and
  `agentTools`), `linking.exports` and `theme`. Public agent files send `Access-Control-Allow-Origin: *`.
  Bridge files stay same-origin.
- **Neuro SAN network JSON.** The host publishes `mosaic.network.json` with two agents: the front agent
  `mosaic` and the internal agent `composer`. Each site publishes `<slug>.network.json` with a front
  agent that holds the site's `website_` tools and strict grounding rules. One generator
  (`providers/agentic.ts`) makes every site's files from one site definition, so the files cannot
  disagree.
- **Link slots.** The host network has one link slot for each suggested site, plus four spare slots.
  The publisher-owned `links.json` binds the suggested slots. Mosaic binds a spare slot in the browser
  when you connect a new site, and hides unbound slots from the model.
- **`sly_data` allow list.** The front agent allows only `project` and `version` to pass to a peer
  (`allow.to_downstream.sly_data`). Other private context stays in the caller.
- **nsdeploy actions.** Each site registers one bridge action per capability with the runtime's
  `registerActions`: `effect` read or irreversible, `availability: "bridge"`, `callerOrigins` set to
  the allowed Mosaic hosts, and `confirmsInWindow` on every write. Reads run in a hidden frame. Writes
  run in a window on the site's origin, where the site's own sheet confirms them. The bridge page sends
  `frame-ancestors` with the allowed hosts. The site API accepts calls only from its own origin.
- **BYOK through `byok.js`.** The settings dialog saves, selects and deletes profiles with the
  runtime's functions. On localhost, `byok.js` copies profiles into a cookie that every local port
  receives. Mosaic clears that cookie around each call, so no local demo site gets the key.
- **Otari default router.** Every manifest publishes Otari. A profile with an empty router uses it.
- **Consent before contact.** The engine's `onConsent` hook shows the dialog. The connect palette asks
  before its first fetch of a new origin.
- **Exact-name peer resolution.** Mosaic binds a site with `setLink` and then calls `resolveRemote` with
  the exact network name. A wrong name fails closed with the runtime's "No published network named"
  error. `onLinkRequired` returns null, because the runtime's link path accepts a wrong name when a site
  publishes only one network.
- **Budget.** The pinned runtime allows 4 remote calls per turn. Mosaic subclasses `Engine` to allow 8.
  A test fails if the pinned runtime changes the method that this needs.
- **Scout.** Bun, `playwright-core` and Chromium. It learns with Claude (`claude-opus-5-5`, from a
  screenshot and the page structure) when credentials are set, or with rules. Every request from its
  browser goes through a fence that stops it unless it stays on the target origin.
- **Deploy.** One Vercel project per origin, chosen by `MOSAIC_ROLE`, from one prebuilt single-file
  server. Scout runs on a server behind Caddy. `TODO(verify): live URLs.`

## Challenges we ran into

- **The runtime's limits.** The per-turn limit of 4 remote calls was too low for a chain across four
  sites. Unbound spare slots were offered to the model as tools. We fixed both in the wrapper, without
  an edit to the vendored runtime, and we pinned the private method with a test.
- **A lenient link path.** The runtime accepted a wrong network name when a site published only one
  network. We moved all binding to exact-name resolution.
- **The schema subset.** The runtime's `checkSchema` rejected `date-time` and arrays without `items`. It
  also refused result keys that the output schema did not list. The generator now makes schemas that
  pass, and a test runs `checkSchema` and `validateData` on every capability.
- **A key leak on localhost.** `byok.js` mirrors profiles into a cookie on loopback hosts. Cookies are
  not scoped to a port, so every local demo site got the key in its Cookie header. Mosaic now clears
  that cookie.
- **Popups.** A browser blocks a window that opens without a click. A write now waits for the person
  to click "Open <site>".
- **Connect a site Mosaic has never seen.** A strict content policy blocked new sites and BYOK routers.
  The host page now allows frames and fetches to any https origin. Scripts stay limited to the host,
  and consent gates each contact.

## Accomplishments that we are proud of

- A write in Mosaic is approved only on the site's own sheet, on the site's own origin. The model and
  Mosaic's page cannot approve it.
- Scout makes a conformant agentic site from a site that publishes nothing. Its output passes the
  sponsor's `check_partner` script. `TODO(verify): re-run on the deployed Scout over HTTPS.`
- The sponsor's `check_partner` script exits 0 for all seven demo sites (local run).
  `TODO(verify): re-run over HTTPS after the deploy.`
- A recipe link rebuilds a workspace on any Mosaic and carries no secret.
- The vendored runtime is unchanged. Everything Mosaic adds is in its own wrapper.
- `TODO(verify): final test counts (211 unit tests passed at commit bad34d7. The e2e count and the §6
  conformance suite from card C12 come next).`

## What we learned

- The MVP spec is enough for composition across publishers. Link slots, exact-name resolution, peers on
  the caller's model and the `sly_data` allow list do the hard parts.
- Consent belongs to the site. `confirmsInWindow` lets a site show its own sheet, and then the caller
  cannot fake an approval.
- A runtime default is a decision. We needed small, tested overrides for the remote-call budget and the
  link path.
- "Bring your own key" has edge cases on localhost. Check every cookie and header that leaves the page.

## What is next

- The §6 conformance suite with fixtures for a broken network and a cycle (card C12).
- Sign-in for real sites inside the bridge window, and a per-person browser profile for Scout.
- A visibility check stronger than the 700 ms delay (Intersection Observer v2 where browsers have it).
- An entry in the agentic-web showcase list, after the owner agrees.

## Built with

TypeScript, Bun, React, Radix UI, cmdk, the nsdeploy browser runtime (Apache-2.0), the agentic-web
`agentify-website` skill and its `check_partner` script (Apache-2.0), Neuro SAN
network JSON, Otari, playwright-core, Chromium, the Anthropic SDK (Scout's learner), Vercel, Caddy.
