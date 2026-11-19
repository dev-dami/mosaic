# Mosaic design spec

Updated 2026-11-19. This is the contract for the UX rebuild on `ux/foundation`. Tokens live in
`src/host/theme.css`, primitives in `src/host/primitives/`. If this page and the code disagree, fix one
of them in the same commit.

The visual language takes its structure from a warm-parchment product UI: warm neutrals, one accent,
chunky 3D buttons on a hard ledge, dense 13-14px text, uppercase small labels, colour only for
meaning. We take the structure and tone. We never use another product's name, logo, mascot,
illustrations or fonts.

## 1. The flow, simplified

The current runbook asks the person to read too much before they can act. The new flow has four moves.

1. **Say the outcome.** The first thing on the page is one input: "What do you want done?" Typing
   "Launch Lumen v1.0" sets the title, Project and Version, and picks and orders the steps
   (`src/host/entry/plan.ts`, deterministic keyword and name matching, no model). The plan narrows
   inside the sites the outcome names; a site it names nothing on keeps all its steps, after the
   named ones, because the person connected it.
2. **Connect what it needs.** ⌘K (Ctrl K) opens the palette. Paste a URL; the palette runs the staged
   checks in place and ends with "+3 capabilities from tagforge.example". A refused host ends in red
   with the reason. The empty runbook offers the same action as a primary button. A site Mosaic has
   never seen adds its steps the moment it connects.
3. **Run the steps.** Each step shows its output as content. Inputs that are already bound show as one
   line of tokens; the form opens only when the person edits. Wires show where each value came from.
4. **Publish.** Every write waits in one sticky review bar at the bottom: "3 writes ready to publish".
   Each opens that site's own approval sheet. Receipts stay in the document; a toast only echoes them.

**Removed from the main view** (still reachable, behind disclosure):

- The cramped rail form for connecting a site. The palette replaces it; the rail becomes a slim list
  of sources (or goes away on narrow screens).
- The trace of connection checks as permanent rail text. It lives in the palette while connecting,
  then in a source's detail popover.
- The lede paragraph, the kicker, and the Project/Version/Sources/Progress table as a block. Project
  and Version become chips under the outcome; progress moves into the review bar.
- Schema, raw JSON, origins in full, and the "manifest becomes UI" ghost on every field. Schema and Raw
  stay as small toggles; full origins show in provenance tooltips.
- "Ready to publish" as a section the person must scroll to. Write cards remain the place to edit a
  write's inputs, opened from the review bar.
- The serif title face.

## 2. Tokens

All in `src/host/theme.css`, light on `:root`, dark under both `prefers-color-scheme: dark` (unless
`data-theme="light"`) and `:root[data-theme="dark"]`. The shell's theme switch sets `data-theme`.

| Role | Light | Dark | Token |
|---|---|---|---|
| Page | hsl(75 14% 95%) parchment | hsl(240 8% 8%) | `--bg` |
| Toolbars, rail, review bar | hsl(70 16% 93%) | hsl(240 8% 10%) | `--rail` |
| Cards, palette, popovers | #fff | hsl(235 8% 15%) | `--surface` |
| Wells, table heads | hsl(77 13% 89%) / #f9faf7 | hsl(240 8% 10%) / #232429 | `--sunken`, `--sunken-2` |
| Text | #111, 25%, 40% grey | 90%, 75%, 62% | `--ink`, `--ink-2`, `--muted` |
| Lines | hsl(78 13% 85%), hsl(69 8% 65%) | hsl(230 8% 20%), 40% | `--line`, `--line-strong` |
| Hover / press fill | black 7.5% / 5% | white 7.5% / 5% | `--hover`, `--pressed` |
| Focus ring on inputs | 3px black 7.5% | 3px white 10% | `--ring` |
| Accent (one only) | oklch(0.52 0.2 268) ultramarine | oklch(0.72 0.14 268) | `--accent`, `--accent-10/20` |

**Status** is separate from the accent and from site hues: `--success*` (green 150), `--warning*`
(amber 66-92), `--danger*` (red 27), `--info*`. Each has text, `-fill`, `-line` and `-solid`.

**Site hues** come from `src/host/hue.ts`: the host hashes the origin into two bands, 182-250 and
285-350, and keeps connected sites at least 34 degrees apart (three sites always, more when the bands allow). A hue picker snaps any choice back into
the bands (`actions.setHue`). An element that sets `--h` gets `--site-bg`, `--site-ink`,
`--site-line`, `--site-solid`, `--site-wire`. Site colour appears on provenance only (monogram, pill,
token, left ribbon of a block, wire), never as a fill behind content.

**Shape and depth.** Radius 0.25 / 0.375 / 0.625rem. One elevation idiom: `--elev`, a hard 3px ledge
in the line colour, no blur. Only the approval layer and tooltips use a soft shadow.

**Never:** gradients as decoration, accent-tinted hovers, a second accent, a status colour used for
decoration, a site hue in a status band.

## 3. Type

| Use | Face | Size / weight |
|---|---|---|
| Titles, buttons, keyboard chips, numbers in badges | Nunito (self-hosted, `--font-title`) | h1 1.75rem/800, h2 1.3125rem/700, h3 1rem/700, buttons 0.875rem/700 |
| Body, inputs, tables | Geist (`--font-sans`) | 14px/1.5715, tables 13px, `b` is 600 |
| Origins, field keys, code, raw JSON | Geist Mono (`--font-mono`) | 12px |
| Labels (`.label`, table heads) | Geist | 0.6875rem/600, uppercase, 0.075em tracking |

Outcome input: Nunito 800, 32-40px. Sentence case everywhere. Fonts come from npm through
`assets/fonts.css`; no font CDN.

## 4. Components

Primitives (shared, `src/host/primitives/`; areas use them, never restyle them):

| Component | Job | Look |
|---|---|---|
| `Button` | Every action | 3D face on a 3px ledge. `primary` (one per area), `secondary`, `tertiary` (flat, alpha hover), `danger`. Sizes xs/sm/md/lg (1.625 / 2.0625 / 2.3125 / 3.0625rem). Hover lifts 1px with no transition in; press sinks onto the ledge. Never quietly disabled: `disabledReason` keeps it focusable, sets `aria-disabled`, shows the reason in a tooltip. |
| `Tag` | A short status or kind | Outline only, 11px/500, tone colour for text and border. |
| `Kbd` | Shortcut hints | Chip with a 2px bottom ledge; ⌘/Ctrl by platform. |
| `Panel` | Cards | Surface, 1px line, `--elev` ledge. |
| `Tooltip` | Reasons, full origins, where a value came from | Inverted surface, 400ms delay, 100ms in, 50ms out. Mounted once by the shell (`TooltipProvider`). |
| `Banner` | What happened and what to do | Tone fill and line, icon, optional actions. |
| `EmptyFrame` | Empty states | 2px dashed frame, title that says what to do, one line, one action row. |
| `Disclosure` | Progressive disclosure | Small text toggle; content renders only when open. |
| `Monogram`, `Provenance`, `Token`, `Origin` | Which site a thing comes from | Host-drawn, site hue. Sites never draw these. |

Area components to build (each owned by one area, see section 8):

| Component | Area | Job and look |
|---|---|---|
| Outcome input | B | The first action. Large Nunito input with a placeholder that says what to type, Project and Version as editable chips under it, `react-textarea-autosize` if it wraps. Re-plans steps as the person types (debounced, animated with `motion` layout). |
| Command palette | B | `cmdk` dialog on ⌘K. Groups: Connect (a URL typed becomes "Connect <origin>"; `shouldFilter={false}` for URLs), Suggested sites, Steps (jump to), Actions (theme, review). Connecting shows the four stages inline, then "+N capabilities from <host>" with `@number-flow/react`. A refused host is a red row with the reason and no retry spinner. |
| Sources list | B | Slim list or popover: monogram, name, status dot, capabilities on hover; the hue picker (`@radix-ui/react-slider` over a track with the reserved bands hatched) lives in the source's popover. |
| Step block | A | Number, title, provenance pill. Output first as content; bound inputs as one line of tokens; Edit opens the fields. One primary button per step. |
| Wires | A | Hand-drawn strokes (`perfect-freehand` over a level-ended cubic computed in `wires.tsx`) from an output token to the inputs it fills, recomputed by ResizeObserver. Below 640px there are no margin wires: each output's "→ feeds" row names the later steps that take it, and bound inputs carry tokens with the source step's number. |
| Review bar | C | Sticky bottom bar on `--rail` with a ledge on top: count of pending writes (rolling number), the sites involved as monograms, one primary "Review N" button, and progress. Expands (motion) into the write cards. |
| Write card | C | Title, "Changes <site>" tag, inputs via `InputFields compact`, one secondary button "Approve on <host>". Done shows a receipt with the result's links. |
| Receipts and toasts | C | Receipts stay in the document and the activity log. `sonner` (unstyled, chunky card) echoes each result; never the only record. |
| Approval sheet | C (`providers/bridge.html`, `providers/sheet.ts`) | The site's own page, its own look. Show values with human labels: "Pre-release: No", not "Pre-release false". A generic sheet cannot know the site's current state, so the only comparison it shows is against the last request it saw for the same capability (`diffWordsWithSpace`), from the sheet's own memory. Plain DOM only; no React on the site's origin. |

## 5. Interaction

- Keyboard first: ⌘K palette, Enter runs the focused step, ⌘↵ opens review, Esc closes. `tinykeys`
  for bindings. Every shortcut also has a visible button with a `Kbd` hint.
- One primary button per area. Everything else is secondary or tertiary.
- Nothing disabled without a reason in a tooltip.
- Technical detail (schema, raw JSON, full origin, connect checks) is one click away, never in the
  default view.
- Data flow is visible: hovering a token highlights its source block (`actions.setHot`).
- A write never runs from Mosaic's page. The only way to approve is the site's own sheet.

## 6. Motion

- Buttons: no transition into hover (snappy); 200ms ease back out; 100ms press.
- Inputs and switches 100ms; tabs and badges 150ms; panels, palette and review bar 200ms ease-out
  (`--ease-out`). Tooltips 100ms in, 50ms out.
- Animate in and settle. Never loop, except a spinner while something is actually running.
- `motion` with `MotionConfig reducedMotion="user"`; theme.css also flattens CSS motion under
  `prefers-reduced-motion`.
- `canvas-confetti` is installed for one short burst when every write is approved; it must pass
  `disableForReducedMotion: true`. Optional.

## 7. Copy

Write like you are explaining to a smart friend: specific, direct, honest about limits, no emojis,
no hedge words (helps you, seamless, robust, leverage). Sentence case. Errors say what happened and
what to do. Confirmations name what will change. Never claim something Mosaic did not check.

- "Connect a site" · "Paste a site's URL to add what it can do."
- "+3 capabilities from tagforge.example"
- "Can't reach shop.example. Check the URL and try again."
- "example.org isn't allowed. Its manifest names a different origin."
- "3 writes ready to publish" · "Approve on tagforge.example"
- "No steps yet. Type what you want done."

## 8. Ownership and interfaces

| Path | Owner | Notes |
|---|---|---|
| `src/host/app.tsx`, `shell.css`, `theme.css`, `css.d.ts` | foundation | Thin shell: top bar, layout grid (`auto 1fr`), theme switch, slot mounting. |
| `src/host/state/**` | foundation | One store, typed actions (`state/types.ts`), derived model (`state/model.ts`). |
| `src/host/primitives/**` | foundation | Shared components and their CSS. |
| `src/host/doc.ts`, `hue.ts`, `format.ts`, `bridge-client.ts`, `src/protocol.ts`, `src/form.ts` | foundation | Pure logic and the security boundary. |
| `src/host/runbook/**` | A runbook | Document frame, steps, inputs, outputs, wires. |
| `src/host/entry/**` | B entry | Outcome input, palette, connect flow, sources, refused state, `plan.ts`. |
| `src/host/review/**`, `providers/bridge.html`, `providers/sheet.ts`, `providers/home.ts` | C review | Review bar, write cards, receipts, toasts, approval layer, the site's sheet and home page. |
| `providers/bridge.ts`, `providers/site.ts`, `providers/{docs,releases,announcer}.ts` | foundation | Message checks, 700 ms Approve delay, same-origin API guard. Do not change. |
| `e2e/areas/{entry,runbook,review}.cjs` | the matching area | Selectors only. `e2e/areas/shell.cjs` and `e2e/mosaic.e2e.cjs` (the checks) are foundation. |

Rules for builders: import other areas only through their `index.ts`; use the state through
`useMosaic()` from `src/host/state`; keep UI-only state (open, expanded, hovered) inside your area. If
you need new shared state, add one action at the end of the `Action` union and one reducer case, and
say so in your report.

Kept contracts:

- Every capability renders exactly one element with class `cap`, `data-origin` and `data-capability`
  (reads in A, writes in C), even when the outcome plan hides it from the main view.
- Bound inputs carry `data-flow-dst="<origin>#<capability>|<field>"`; output tokens carry
  `data-flow-src` with the same value; a read block carries `data-flow-anchor="<capKey>"`.
- Bridge iframes: `iframe.bridge[data-origin]`, mounted for as long as the site is connected
  (`ApprovalLayer` must always be mounted). Mosaic never draws over a visible sheet.
- Build badge: `[data-testid=build]`, class `build same` after an unchanged fingerprint.
