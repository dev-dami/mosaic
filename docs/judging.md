# Judging and conformance map

Updated 2026-11-20, at goal/sponsor-spec commit bad34d7. This page maps each judging criterion, each
of the seven interoperability checks in the MVP spec §6 (Profile 0.3) and each hard requirement of the
agentic-web README to the file, test or screen that shows it.

Status:

- **shown**: code and a test (or a recorded check) show it now.
- **partly**: code shows it, but a test, a live run or a part of the check is missing.
- **TODO**: not shown yet.

"C9" marks the agent turn (outcome to runbook). It is built and checked on its own branch, and it lands
next. Its files are `src/host/agentic/turn.ts`, `src/host/runbook/turn.tsx`, `test/turn.test.ts` and
`e2e/agent.e2e.cjs`. "C12" is the conformance suite that comes next (`test/conformance/`). "C13b" is
the public deploy.

## Hard requirements (agentic-web README)

| Requirement | Where it is shown | Status |
|---|---|---|
| A public site | One Vercel project per origin (`docs/deploy.md`, `server.ts`, `src/roles.ts`). `TODO(verify): live URLs after C13b.` | TODO |
| A public `.json` agent network | Host: `/agent-manifest.json`, `/mosaic.network.json`, `/links.json` (`src/host/agentic/network.ts`). Test: `test/host-network.test.ts` "GET /agent-manifest.json, /mosaic.network.json and /links.json answer 200 with ACAO *". Sites: `providers/agentic.ts`, `test/agentic.test.ts` "is public JSON any origin may read, without credentials". | shown (local), TODO (live) |
| A browser runtime that runs it | `vendor/nsdeploy-runtime/` (unchanged, `VENDOR.md`), served at `/runtime/*` (`src/runtime-files.ts`). Wrapper: `src/host/agentic/engine.ts`. Test: `test/engine.test.ts`. | shown |
| A UI to use it | The workspace: outcome box, connect palette (Ctrl K), runbook, review dock (`src/host/entry/`, `src/host/runbook/`, `src/host/review/`). Agent turn UI: `src/host/runbook/turn.tsx` (C9). Tests: `e2e/mosaic.e2e.cjs`, `e2e/agent.e2e.cjs` (C9). | shown (C9 landing) |
| A UI to configure the LLM and keys | "AI model" dialog: `src/host/settings/ModelSettings.tsx` (router, model, key, profiles, Test model, delete). Test: `e2e/settings.e2e.cjs` "Authorization carries the selected key", "only the chat call carries a key". | shown |
| Follows MVP spec Profile 0.3 | Runtime validators in tests: `validateNetwork` and `checkSchema` on every site (`test/agentic.test.ts`) and on Scout output (`test/agent.test.ts`). The sponsor's `check_partner.mjs` exited 0 for all seven sites in a local run (board log, card C4). `TODO(verify): check_partner over HTTPS for every site after C13b.` | partly |
| The host does not pay for LLM calls | No key means manual mode with no model call (`engineOptions`, `MosaicAgent.runTurn` in `src/host/agentic/engine.ts`). Test: `test/engine.test.ts` "no key means manual mode on the published default; a turn is refused before any call". `e2e/agent.e2e.cjs` "no agent turn runs without a key" (C9). | shown |

## MVP spec §6 interoperability checks

| # | Check (spec §6) | Where it is shown | Status |
|---|---|---|---|
| 1 | Publish a two-agent network and a manifest from an ordinary HTTPS host | `mosaic.network.json` has the front agent `mosaic` and the internal agent `composer` (`src/host/agentic/network.ts`). Tests: `test/host-network.test.ts` "has a front agent mosaic and an internal agent composer", "the vendored validator returns no errors". `TODO(verify): served over HTTPS after C13b.` | partly |
| 2 | Run with the site's published default router and model, and with the BYOK path | Every manifest publishes Otari (`llm_router`). A profile with an empty router uses Otari (`test/engine.test.ts` "a profile sets key, router and model; an empty router means Otari"). BYOK: `e2e/settings.e2e.cjs` "the router got the chat call", "Authorization carries the selected key". Otari needs the visitor's key, so a keyless default run does not exist (manual mode instead, owner decision). `TODO(verify): one real turn on Otari with a visitor key.` | partly |
| 3 | Call an internal agent and at least one grounded capability through a registered site action | The front agent calls `composer`. Peers call `website_` tools, which are nsdeploy bridge actions (`providers/bridge-actions.ts`). Tests: `test/turn.test.ts` "peer calls become steps, website_ calls become cards, composer is Mosaic's own step" (C9). `e2e/agent.e2e.cjs` runs composer, a peer read and an approved write on a scripted router (C9). | shown (C9 landing) |
| 4 | After user approval, load an exact named network from a second origin and run it in the caller's browser | `MosaicAgent.connectNetwork` (consent, then `setLink`, then exact `resolveRemote`). Consent dialog: `src/host/settings/engine-context.tsx`. Tests: `test/engine.test.ts` "connectNetwork asks consent naming the origin…", "connectNetwork with a wrong name rejects with the runtime's exact-name error and unbinds", "a declined consent contacts nothing". `e2e/mosaic.e2e.cjs`: a wrong name shows 'has no network named "wrongname"', and Inkpost, started after Mosaic loads, connects. | shown |
| 5 | With a user key active, the second site never receives it and cannot change the caller's router | `e2e/settings.e2e.cjs` fails if the key appears in any request header other than Authorization to the selected router. The byok.js loopback cookie is cleared (`src/host/settings/byok-store.ts`, `test/engine.test.ts` "the cookie the settings clear is the one the pinned byok.js writes"). Peers run on the caller's router (runtime behavior, spike note in `docs/spike-nsdeploy.md`). Missing: a test that a peer manifest with its own `llm_router` does not change the router (C12). | partly |
| 6 | Private context is absent at the peer unless a named field is allowed | The front agent allows only `project` and `version` (`allow.to_downstream.sly_data`). Test: `test/host-network.test.ts` "only project and version may cross to a downstream site". The runtime filters with `filterSlyData`. Missing: a test that reads what a peer receives (C12). | partly |
| 7 | Stop an invalid network, a composition cycle, an over-budget request and a denied origin with visible errors | Invalid network: `MosaicAgent.create` throws on validation errors, and a wrong network name stops the connect with a visible message (`e2e/mosaic.e2e.cjs` "a refused network adds nothing"). Denied origin: "a declined consent contacts nothing" (`test/engine.test.ts`). Budget, cycle, declined and unreachable sites become visible problem steps (`test/turn.test.ts` "budget, cycle, declined and unreachable sites are visible problems", C9). Missing: fixtures for a broken network and a real cycle (C12). | partly |

## Judging criteria

### 1. Technological implementation

| What a judge looks for | Where it is shown | Status |
|---|---|---|
| Built on the spec, not beside it | Sites publish only sponsor formats: `agent-manifest.json`, Neuro SAN network JSON, `links.json`, nsdeploy action bridge (`providers/agentic.ts`, `providers/bridge-actions.ts`). The older Mosaic formats are deleted. | shown |
| The sponsor's runtime, unchanged | `vendor/nsdeploy-runtime/VENDOR.md` (diff check). Overrides live in `src/host/agentic/engine.ts`, pinned by `test/engine.test.ts` "the pin: the vendored runtime still has _makeCtx and still defaults to 4". | shown |
| Security rules from spec §4 and §5 | Consent before contact, exact-name peers, `callerOrigins`, `confirmsInWindow`, `frame-ancestors`, same-origin site API, router-only key, fail closed on unknown outcomes. Tests: `test/bridge-actions.test.ts`, `test/site.test.ts`, `e2e/mosaic.e2e.cjs` ("the sheet is on the site's own origin", "a denied write must not reach the site", "Approve starts disabled", "the browser must block a direct cross-origin call", "an unknown outcome offers no retry"). | shown |
| Observable execution (spec §5) | Runbook steps per peer call, cards per `website_` call with input and output, the model and router host on the activity log (C9). Connect trace stages in the palette (`src/host/entry/trace.tsx`). | shown (C9 landing) |
| Tests | `bun run test` (211 passed at bad34d7), `bun run e2e`. `TODO(verify): final counts after C9 and C12.` | partly |
| Live and reproducible | `docs/deploy.md`, `scripts/build-deploy.ts`, `test/deploy-build.test.ts`. `TODO(verify): live URLs.` | partly |

### 2. Quality of the idea

| What a judge looks for | Where it is shown | Status |
|---|---|---|
| Non-obvious use of open agentic websites | Composition across publishers: one outcome, several sites' networks in one turn, in the visitor's browser (C9 turn, `src/host/agentic/engine.ts`). | shown (C9 landing) |
| The site, not the agent, owns consent | Writes run only in a window on the site's origin with the site's own sheet (`providers/bridge-actions.ts`, `providers/sheet.ts`, 700 ms Approve delay). | shown |
| Reaches sites that publish nothing | Scout (`agent/`, `docs/agents.md`). Tests: `test/agent.test.ts` "a Scout-served template conforms to MVP profile 0.3", `test/scout-guard.test.ts`. `TODO(verify): Scout live behind Caddy after C13b.` | shown (local) |
| Shareable workspaces with no secret | Recipe links (`src/host/recipe.ts`). Tests: `test/recipe.test.ts` "the link carries no key, router, model, input values or results", `e2e/recipe.e2e.cjs`. | shown |
| A clear problem | Demo story: a bug report under a video becomes an issue, a fix and a post, across four sites (`docs/demo-script.md`). | shown |
