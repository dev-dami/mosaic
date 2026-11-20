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
   checks in place and ends with "+3 capabilities from Tagforge". A refused host ends in red
   with the reason. The empty runbook offers the same action as a primary button. A site Mosaic has
   never seen adds its steps the moment it connects.
3. **Run the steps.** Each step shows its output as content. Inputs that are already bound show as one
   line of tokens; the form opens only when the person edits. Pointing at a token draws one wire from
   where the value came from.
4. **Publish.** Every write has one home: the review bar on the document column ("3 changes to
   approve") and the drawer it opens (a side panel at 1200px and wider, a bottom sheet on phones). A
   step only carries an outline tag, "1 change to publish", that opens it. Each card opens that site's
   own approval sheet. The card becomes the receipt and the activity log keeps it; a toast only echoes.

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
| Actions, links, focus, selection | ink: hsl(240 5% 17%) button, `--ink` text | pale ink: hsl(60 8% 92%) button | `--btn1-*`, `--accent` (= ink), `--accent-10/20` |

**Status** is separate from the accent and from site hues: `--success*` (green 150), `--warning*`
(amber 66-92), `--danger*` (red 27), `--info*`. Each has text, `-fill`, `-line` and `-solid`.

**Colour has two jobs.** *Who*: a site's identity colour. *State*: success, warning, danger, info.
Everything else is neutral: parchment and graphite surfaces, and ink for actions, links, focus and
selection. Mosaic's own colour is ink, the piece in the middle of its mark. This follows the 60-30-10 rule:
neutrals carry the page, ink carries the actions, and hue is spent only on meaning.

**Site identity colours** come from the site. Its manifest declares `site.theme_color` (as in the Web
App Manifest), and `src/host/hue.ts` takes its OKLCH hue. When that hue is within 34 degrees of a site
already connected, it moves the shortest way out, so a site cannot dress up as another one. A site
that declares nothing gets one of eight slots, 45 degrees apart. Lightness and chroma are Mosaic's,
fixed per role in `theme.css`, so any hue meets contrast. An element that sets `--h` gets `--site-bg`,
`--site-ink`, `--site-line`, `--site-solid` and `--site-wire`. Site colour appears once per place, on
provenance only (monogram, site pill, token, the left ribbon of a block, wire), never as a fill behind
content and never repeated on navigation.

**Identity and state are told apart by form, not by hue.** A site colour is always a mark beside the
site's name. A status is always an icon and a word, on its own fill. A coral site can therefore sit
beside a red error without being read as one.

**Demo cast palette** (evenly spaced, at least 34 degrees apart): Reelhouse #d6407f (359), Loudhailer
#e8563a (33), Foreman #c98a00 (76), Patchbay #0f9f7a (168), Inkpost #3fb5c9 (211), Pagewright #1f78d1
(253), Tagforge #9b7bff (292).

**The mark** (`MosaicMark` in `src/host/app.tsx`, `assets/logo.svg`): four tiles in a pinwheel around an
empty square. The tiles are sites, in four of the cast's hues. The square is the missing piece, in ink,
and it drops into place when the first site connects.

**Contrast.** Body and secondary text meet 4.5:1 on every surface in both themes, `--faint` included
(62% ink in light, 56% in dark). Diff lines keep ink text; only the band and the +/- sign carry status.

**Shape and depth.** Radius 0.25 / 0.375 / 0.625rem. One elevation idiom: `--elev`, a hard 3px ledge
in the line colour, no blur. Only the approval layer and tooltips use a soft shadow.

**Never:** gradients as decoration, a hue on an action, a status colour used for decoration, a status
shown by colour alone, a site colour without the site's name beside it, text in a status colour on a
status fill.

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
| Step block | A | Sticky header under the top bar: number, title, a "N changes to publish" outline tag in the site's hue, the site chip. Context reads (no input) show in the site chip's details. Output first as content; bound inputs as one line of tokens; Edit opens the fields. A chunky Run only before the first run, then a tertiary "Run again". |
| Wires | A | On demand only: while an output token, a "feeds" link or an input's source token is hovered or focused (`runbook/flow.ts`), one hand-drawn stroke (`perfect-freehand`) joins that output to the input it fills, and both ends light up. Nothing is drawn at rest; below 640px never. |
| Review bar | C | A bar with the same left edge and width as the document column: "3 changes to approve", a neutral tile per change (site monogram and state mark), one primary "Review" with ⌘↵. Opens into the write cards: a side panel that pushes the layout aside at 1200px and wider, an overlay drawer below, a draggable bottom sheet on phones. |
| Write card | C | Title, site pill, inputs via `InputFields compact`, one secondary button "Approve on <site>" with the origin beside it in mono. Done fills the number with a check, washes the card in `--accent-10` once, and shows the receipt with the result's links. |
| Receipts and toasts | C | The card and the activity log keep each answer. `sonner` (unstyled, chunky card, bottom right above the bar, beside the side panel) echoes each result; never the only record. |
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
- No celebration effects. A published write gets the check and a 1.5s accent wash on its card.

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
| `src/host/doc.ts`, `hue.ts`, `format.ts`, `agentic/catalog.ts`, `src/protocol.ts`, `src/form.ts` | foundation | Pure logic and the security boundary. |
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
