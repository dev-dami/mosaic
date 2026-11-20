# Spike: the nsdeploy runtime under Mosaic (card C1)

Date 2026-11-20, on main 2f303fc plus the C2 vendoring. Runtime: `vendor/nsdeploy-runtime`
(agentic-web 0516537, unchanged). Citations are `file:line` in that folder.

The spike code is throwaway and lives in `spike/`: `serve.ts` (hand-written Pagewright
artifacts, a host page, four chain peers, a scripted OpenAI-compatible mock router),
`run.cjs` (headless Chromium driver), `check-schemas.ts` (R4), `run-output.txt` (the last
run). Rerun: `bun spike/serve.ts`, then `CHROMIUM_PATH=... node spike/run.cjs`.
Delete `spike/` once C3, C4 and C6 land.

Labels: [observed] = seen in a run; [code] = read in the runtime, not run; [untested].

## R0. Engine without mountApp, one turn, exact-name resolveRemote

- [observed] A page on :4000 does `await import("/runtime/index.js")`, builds
  `new Engine({ originUrl, trace: new TraceBus() })`, runs `loadTop()` (network `mosaic`,
  no validation errors), and nothing mounts (`[data-nsdeploy-ui]` absent). index.js
  re-exports `mountApp` (index.js:10), so ui.js is fetched and parsed, but importing it has
  no side effect that showed: the bridge prompt seen in R3 is the plain one in
  action-transport.js, not ui.js's. C6 can import `/runtime/engine.js` directly to skip
  ui.js (about 99 KB).
- [observed] With `setLink("pagewright_slot", "http://localhost:4101/pagewright")` and
  `runtimeAllowedPeers.add(origin)`, one `streamTurn` ran host → Pagewright → the
  `website_preview-docs-update` tool through the hidden-iframe bridge, and back. Event types:
  turn.started, agent.started, tool.started, tool.completed, agent.output.delta,
  agent.completed, turn.completed. Spans: remote_fetch, remote_call (peer localhost:4101).
- [observed] `resolveRemote("http://localhost:4101/pagewright")` returns the session for
  network `pagewright`. `/wrongname` and `/Pagewright` both throw
  "No published network named '…' at localhost:4101; refusing to run a different network."
  (engine.js:424). A peer not in allowed_peers throws "Policy: … is not in mosaic's
  allowed_peers" (engine.js:235).
- [observed] **Trap:** the link path is lenient. `_normalizeLinkTarget("pagewright_slot",
  ".../wrongname")` returned `.../pagewright`, because a site with one network is taken
  whatever the name (engine.js:295, also a fuzzy name and alias match above it). That path
  runs when `onLinkRequired` supplies a URL (engine.js:305-331). C7 must bind with
  `setLink` and call `resolveRemote` with the exact name, not go through `onLinkRequired`.
- [observed] No mock request carried an Authorization header (39 requests, keyless mock
  router with `llm_router.mock: true`).

## R1. maxRemoteCalls

- [code] Hard-coded per turn in `runTurn`: `maxRemoteCalls: 4`, `maxCallsPerPeer: 1`,
  `maxAgentCalls: 24`, `deadline: +90 s` (engine.js:526-534). Enforced in
  `consumeRemoteBudget` (runner.js:63-74). Nested peer calls share the same composition
  object (runner.js:479 passes it to `Session.invoke`), so a chain A→B→C counts every hop.
- [observed] Default: host with 5 peer tools, one turn. Calls 1-4 ran; the 5th gave the
  note "the per-query limit of 4 third-party calls was reached" and the model got
  "Skipped …" as the tool result.
- [observed] Configurable without editing the runtime: subclass `Engine` and override
  `_makeCtx(args)` to set `args.composition.maxRemoteCalls` before `super._makeCtx(args)`
  (`_makeCtx` at engine.js:340). With 8, all 5 peers ran in one turn. It relies on a private
  method, so pin it with a conformance test in C12. The design's other answer (one turn per
  runbook step) needs no override.
- `maxCallsPerPeer: 1` means one turn cannot ask the same peer twice (preview then apply on
  Pagewright needs two turns, or both tools in one partner turn).

## R2. Unbound link slots

- [observed] They are **in** the tool table. The host front agent was offered
  `pagewright_slot, extra_1, extra_2` with only the first bound. classifyTool maps an
  unresolved slot to kind `link` (kernel.js:198), and buildToolTable advertises it
  (runner.js:206-213). When called: with no `onLinkRequired` it throws
  "Agent-network link '…' is unresolved" (engine.js:308); with `onLinkRequired` returning
  null the model gets "The user did not link '…'" (runner.js:432). A scripted model called
  both spare slots.
- [observed] Workaround without editing the runtime: after `loadTop()`, filter the front
  agent spec's `tools` to drop unbound slot refs
  (`spec.tools = spec.tools.filter(r => !net.linkSlots.has(r) || net.getLink(r))`). The
  next turn offered only `pagewright_slot`. The spec object is the one the runner reads
  (kernel.js:179-181). Re-run it after each `setLink`. Alternative: C5 publishes no spare
  slots and the host serves a network with exactly the slots it binds.

## R3. Write popups during a turn

- [code] The runtime never calls `window.open` outside a click. `openActionWindow`
  (action-transport.js:61-81) shows a `<dialog>` "Continue at <origin> to authorize this
  action" with "Open action site" / "Cancel"; `window.open` runs in that button's click
  (action-transport.js:72). A host can replace the dialog with `setActionWindowPrompt(fn)`
  (action-transport.js:59); `fn({url, origin, brand, signal})` must call `window.open` in
  the visitor's click and resolve with the window (ui.js:976-1005 is the reference). It is
  not exported from index.js: import `/runtime/action-transport.js` (same URL, same module
  instance).
- [code] Writes always use the popup: the caller opens it for any non-read
  (action-transport.js:172), and the bridge refuses a write unless it is a top-level window
  with an opener (action-transport.js:216). `confirmsInWindow` skips the bridge's generic
  review dialog (action-transport.js:223) so the action's own sheet confirms. The catalog
  sent to callers drops `confirmsInWindow` (action-transport.js:209), so the caller's
  registry shows false; that is expected.
- [observed] Turn "APPLY docs": the dialog appeared, no popup opened in 1.5 s, a click on
  "Open action site" opened `http://localhost:4101/bridge/action-bridge.html`, the spike's
  own Approve button rendered there (no generic dialog), and after Approve the turn
  finished with status `succeeded`, revision 2. A partner's irreversible action is not
  confirmed on the caller page (runner.js:375-376); the popup is the confirmation.
- [observed, inconclusive] Headless Chromium let `window.open` succeed without a gesture
  even with `--disable-popup-blocking` removed, so headless runs cannot prove the blocker's
  behaviour. Real browsers [untested]; moot, since the runtime always waits for a click.
- [code] Discovery: if the hidden iframe cannot connect within 10 s (framing blocked), the
  runtime falls back to the popup dialog just to read the catalog (action-transport.js:159-160).
  So `frame-ancestors` on `/bridge/*` must list the host origin or the visitor gets a
  surprise popup during `resolveRemote`.

## R4. checkSchema and Mosaic's schemas

- [observed] `bun spike/check-schemas.ts`: 31 accepted, 7 rejected.
  - `format: "date-time"` (Loudhailer schedule-announcement, Inkpost send-issue): only
    `date` and `email` (actions.js:22).
  - `type: "array"` with no `items` in 5 output schemas (Tagforge list-releases, Reelhouse
    list-videos and read-comments, Patchbay list-issues, Foreman list-servers): items is
    checked recursively and must be a schema (actions.js:32).
- [code] Accepted: any `x-*` key, so `x-mosaic-widget`, `x-width` etc. pass (actions.js:19);
  `default`, `title`, `description`. Rejected: `pattern`, `oneOf`, `anyOf`, `const`, and
  `additionalProperties` other than false (actions.js:28).
- [code] Runtime validation is stricter than Ajv: an object rejects keys not in
  `properties` even without `additionalProperties: false`, and outputs are validated when
  `outputSchema` is given (actions.js:147, action-transport.js:226). So every `run` result
  must match its output schema exactly, nested objects need `properties`, and `date-time`
  inputs need another shape (a `date` plus a time string, or plain `string` with a
  description). C3/C4 should map or fix these in the generator, with a test that runs
  checkSchema over every capability.

## R5. Otari and BYOK

- [observed in files] All three examples publish
  `llm_router: { base_url: "https://api.otari.ai/api/v1", mock: false, byok_router: same }`
  and set `llm_config.model_name: "alibaba/qwen3.8-flash"` in the network file
  (examples/*_agentified/agent-manifest.json and *.network.json). docs/providers/otari.md:
  keys start `otk_`; EU keys (`otk_v1_eu_`) only work at `https://eu.api.otari.ai/api/v1`
  (wrong region answers 421); base URL must end in `/api/v1`; hosted Otari allows browser
  CORS; some models fail every request (qwen3-14b, qwen3-30b-a3b).
- [code] A visitor needs their **own** Otari key. With a non-mock router and no key, the
  client refuses before sending (llm.js:66-73). The key goes only as
  `Authorization: Bearer` to the active router (llm.js:116-119). A peer always runs on the
  caller's router (engine.js:219-224) and cannot redirect it. The host pays nothing; the
  keyless path is Mosaic's plan.ts runbook (no inference).
- [code] Router choice: no key → `base_url` (engine.js:71); a real key or a model with no
  router override → `byok_router`, error if missing (engine.js:60-66).
- [code] byok.js: profiles `{id, name, key, model, router, runner, updatedAt}`, up to 12,
  stored in plain text in `localStorage["nsweb-byok-profiles-v1"]` (byok.js:11, 170-174),
  API `upsertByokProfile / deleteByokProfile / selectByokProfile / loadTabByokSetup`
  (byok.js:36, 57, 70, 149). The applied setup is also kept per tab in sessionStorage
  (byok.js:13-17, 118-135).
- [code] **Leak risk in local dev:** on localhost/127.0.0.1 the whole profile store,
  keys included, is mirrored to a cookie `nsweb_byok_profiles_v1` with `Path=/`
  (byok.js:109-113, 173, 188-198). Cookies are not port-scoped, so every demo site on
  localhost would receive the key in its `Cookie` header. This breaks §6 check 5 locally
  (not on real hosts). C6 should not call `upsertByokProfile` on loopback as is: either keep
  its own store, or clear the cookie after each write, or run the demo on distinct hostnames
  (e.g. `127.0.0.1` for the host, `localhost` for sites). C12's "no key in any site log"
  test should check the Cookie header too.

## For later cards

- C3 generator: fix the 7 schemas (or map them) before registering; add `items` to arrays;
  no `date-time`. Link slots need `link_slots` in the network file; a links.json binding
  only applies to refs listed there (kernel.js:176, 207-209).
- C4 bridge: the template page loads `../runtime/action-bridge.js`, served by C2. The
  spike's bridge (in `spike/serve.ts`) worked with read via hidden iframe and an
  irreversible `confirmsInWindow` write in the popup.
- C5/C6 engine wrapper: subclass Engine for the remote-call budget if needed; prune unbound
  slots after each bind; set `onLinkRequired` to return null (never let it rebind); supply
  `setActionWindowPrompt` for a Mosaic-styled prompt; set `onConsent` (headless default is
  "allow", engine.js:133).
