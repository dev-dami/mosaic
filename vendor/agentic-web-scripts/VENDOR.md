# Vendored: agentic-web partner check

- Source repository: https://github.com/cognizant-ai-labs/agentic-web
- Path: `skills/agentify-website/scripts/check_partner.mjs` → `scripts/check_partner.mjs`
- Commit: `0516537` (05165377aca457381bd41b5c05e7a26cd23e6d74, 2026-11-19)
- License: Apache-2.0 (`LICENSE`, copied from the repository root). The attribution is the
  source repository above.

`scripts/check_partner.mjs` is copied unchanged. Do not edit it. It imports `../runtime/*.js`, so
`runtime` is a symlink to `../nsdeploy-runtime`, the skill runtime from the same commit
(`vendor/nsdeploy-runtime/VENDOR.md`). Check with:

    diff vendor/agentic-web-scripts/scripts/check_partner.mjs <agentic-web>/skills/agentify-website/scripts/check_partner.mjs

It must print nothing.

Used by `test/agent.test.ts` (a Scout-served site) and `test/conformance/s6-1-publish.test.ts`
(every demo site and the host), so those checks run without a copy of the agentic-web repository.
