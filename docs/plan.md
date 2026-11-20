# Mosaic plan

Updated 2026-11-20. The Open Agentic Web Challenge closes on 2027-01-11 (Devpost). The submission needs
a text description, a public YouTube video under 2 minutes that shows the project in a browser, and the
Otari account email. Draft text: [submission.md](submission.md). Conformance map: [judging.md](judging.md).

## Decisions

- **The format is the sponsor's spec.** On 2026-11-20 the owner chose to rebuild on the agentic-web MVP
  spec, Profile 0.3: `agent-manifest.json`, Neuro SAN network JSON, `links.json` and nsdeploy actions.
  The earlier option B of this plan (read tool declarations from a signed WebAgentica `agent.pkg`) is
  **superseded**. Options A and C are superseded too. Mosaic's own formats (capabilities/0 and
  bridge/0) are deleted.
- **The runtime is the sponsor's.** Mosaic vendors the nsdeploy browser runtime from the agentic-web
  `agentify-website` skill (Apache-2.0, commit `0516537`) into `vendor/nsdeploy-runtime/`, unchanged.
  Mosaic's own work sits on top: composition across sites, site-owned approval, Scout and recipes.
- **Inference.** Every manifest publishes the Otari router. The visitor brings a key (BYOK). With no
  key, Mosaic runs in manual mode and makes no model call, so the host never pays.

## What is built

Each item is on the integration branch `goal/sponsor-spec` unless it says otherwise.

| Area | State | Where |
|---|---|---|
| Vendored runtime, served at `/runtime/*` on every origin | built | `vendor/nsdeploy-runtime/`, `src/runtime-files.ts` |
| Site generator: manifest, network, `links.json`, bridge manifest, CORS on public files only | built | `providers/agentic.ts`, `providers/site.ts` |
| Bridge actions with `callerOrigins` and `confirmsInWindow`, the site's own sheet, `frame-ancestors` | built | `providers/bridge-actions.ts`, `providers/sheet.ts` |
| Host manifest and `mosaic.network.json` (agents `mosaic` and `composer`, link slots, `sly_data` allow list) | built | `src/host/agentic/network.ts` |
| Engine wrapper: consent, exact-name binding, hidden spare slots, budget of 8 | built | `src/host/agentic/engine.ts` |
| AI model dialog (BYOK profiles through `byok.js`) and the consent dialog | built | `src/host/settings/` |
| Connect by URL through the runtime, review dock with receipts | built | `src/host/entry/`, `src/host/review/` |
| Agent turn: the outcome runs Mosaic's network, peer steps with site chips, `website_` cards with input and output, writes wait for "Open <site>" | built, lands next (card C9) | `src/host/agentic/turn.ts`, `src/host/runbook/turn.tsx` |
| Scout publishes conformant agent files for learned sites | built | `agent/scout.ts`, `agent/skill.ts` |
| Scout target allow list, browser fence, request limits, Caddy files | built | `agent/targets.ts`, `deploy/` |
| Recipe links `recipe/1` (outcome, network URLs, Scout templates, no key) | built | `src/host/recipe.ts` |
| Deploy build: one prebuilt single-file server, one Vercel project per role | built | `scripts/build-deploy.ts`, `vercel.json`, `docs/deploy.md` |

## Remaining work

| Card | Work | Needs |
|---|---|---|
| C9 | Land the agent turn after its check. | - |
| C12 | §6 conformance suite in `test/conformance/`, with fixtures for a broken network and a cycle. Tests for checks 5 to 7: a peer cannot change the router, a peer receives only allowed `sly_data`, visible errors for every stop case. Vendor `check_partner.mjs` into `scripts/` so its tests always run. Stop e2e child servers when a check fails. Add a SIGTERM handler to `scripts/dev.ts`. Tell the person when a recipe is cut to 20 sites or 2,000 characters. | C9 |
| C13b | Deploy the nine Vercel projects and Scout behind Caddy. Run the smoke checks and `check_partner` over HTTPS. Fill the live URLs in the README, `submission.md` and `demo-script.md`. | C12, owner OK for a production deploy from `main` |
| C15 | Finish the submission text after C12 and C13b. Replace every `TODO(verify)`. | C12, C13b |
| C16 | Record the video on the live URLs. The owner records it and posts it on YouTube. | C13b |
| - | Make the repository public before the submission. | owner |
| - | Submit on Devpost with the Otari account email. | owner |
| - | Optional: an entry in the agentic-web showcase (`docs/agentic_websites.md`, by pull request). | owner OK |

## Known gaps

- shortcut: the clickjacking guard is the 700 ms Approve delay only. Upgrade: Intersection Observer v2
  (`trackVisibility`) where available.
- shortcut: no sign-in. Demo sites keep state in memory and reset on a cold start. Real sites need
  sign-in inside the bridge window (popup sign-in or the Storage Access API).
- shortcut: Scout drives each site with no cookies, so it cannot act inside a person's account. That
  needs a per-person browser profile.
- The Otari default needs the visitor's key. A keyless default would make the host pay, so keyless runs
  manual mode.
- The per-turn budget override uses a private runtime method (`Engine._makeCtx`). A test fails if the
  pinned runtime changes it.
- The e2e test needs `CHROMIUM_PATH` on this machine, because the cached Chromium revision differs from
  the one that `playwright-core` expects.
