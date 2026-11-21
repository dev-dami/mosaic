// The ⌘K palette: search the steps of connected sites, or paste a URL to connect a new site.
// Connecting runs in place: the four real checks fill a ring around the site's monogram, then the
// capabilities it brought are dealt in under "+N capabilities from <host>". A refused host ends
// in red with what happened and what to do. Nothing here is faked: every row mirrors a stage the
// store reported (state.trace).
import NumberFlow from "@number-flow/react";
import { ArrowRightIcon, CheckIcon, LinkIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon, PencilSimpleIcon, PlugIcon, PlusIcon, ProhibitIcon, RobotIcon, TextAlignLeftIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { tinykeys } from "tinykeys";
import { connectTarget } from "../agentic/catalog";
import { learnerName, scout, type Template } from "../agent";
import { recipeCuts, recipeLink } from "../recipe";
import { capAnchor, hostOf, monogram, type CapRef } from "../doc";
import { Button, Kbd, Monogram, Origin, Tag, useHueStyle } from "../primitives";
import { openReview } from "../review";
import { useMosaic, type Trace } from "../state";
import { checkRows, Checklist, isDone, refusalOf } from "./trace";
import { asOrigin, entryUi, useEntryUi } from "./ui";

/** A typed site address with its network name kept (`<origin>/<network>`), or the bare origin. */
function asTarget(text: string): string | null {
  const t = connectTarget(text);
  return t ? (t.network ? `${t.origin}/${encodeURIComponent(t.network)}` : t.origin) : null;
}

/** Scroll a capability's block into view and light it up for a moment. */
export function jumpTo(key: string, setHot: (k: string | null) => void) {
  setTimeout(() => {
    const el = document.getElementById(capAnchor(key));
    el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    setHot(key);
    setTimeout(() => setHot(null), 1400);
  }, 60);
}

export function Palette() {
  const { open, seed, autoConnect } = useEntryUi();
  const { state, model, actions } = useMosaic();
  const [query, setQuery] = useState("");
  const [watching, setWatching] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      tinykeys(
        window,
        {
          "$mod+KeyK": (e) => {
            e.preventDefault();
            if (open) entryUi.closePalette();
            else entryUi.openPalette();
          },
        },
        { ignore: () => false },
      ),
    [open],
  );

  /** `target` is an origin or `<origin>/<network>`; the workspace keys a connection by its origin. */
  const connect = (target: string) => {
    const origin = connectTarget(target)?.origin ?? target;
    const existing = model.connFor(origin);
    if (existing) {
      const first = model.refs.find((r) => r.origin === origin);
      entryUi.closePalette();
      if (first) jumpTo(first.key, actions.setHot);
      return;
    }
    setWatching(origin);
    void actions.connect(target);
  };

  const traceRef = useRef(state.trace);
  traceRef.current = state.trace;
  const getTrace = () => traceRef.current;

  // On open: take the seed, connect it if asked, or pick up a connection still running.
  useEffect(() => {
    if (!open) return;
    setQuery(seed);
    const t = getTrace();
    const origin = asTarget(seed);
    if (autoConnect && origin) connect(origin);
    else setWatching(t && !refusalOf(t) && !isDone(t) ? t.origin : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const urlOrigin = asTarget(query);
  const trace = watching && state.trace?.origin === watching ? state.trace : null;
  const pendingSuggestions = (state.host?.suggestions ?? []).map((s) => asOrigin(s)).filter((o): o is string => !!o && !model.connFor(o));
  const templates = useTemplates(open ? state.host?.agent : undefined);
  const pendingTemplates = templates.filter((t) => !model.connFor(t.origin));
  const [copied, setCopied] = useState(false);
  // A recipe over its limits is cut to fit; say so here, before and after copying, never silently.
  const cuts = recipeCuts(state);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (trace) {
      e.preventDefault();
      if (isDone(trace)) goToSite(trace.origin);
      return;
    }
    if (urlOrigin) {
      e.preventDefault();
      connect(urlOrigin);
    }
  };

  const goToSite = (origin: string) => {
    const first = model.refs.find((r) => r.origin === origin && !model.hidden.has(r.key)) ?? model.refs.find((r) => r.origin === origin);
    entryUi.closePalette();
    if (first) jumpTo(first.key, actions.setHot);
  };
  const reset = () => {
    setWatching(null);
    setQuery("");
    input.current?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
    <Dialog.Root open={open} onOpenChange={entryUi.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content
          className={`palette ${trace ? "is-connecting" : ""}`}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Search steps or connect a site</Dialog.Title>
          <Command label="Site URL or search" shouldFilter={!urlOrigin && !trace} filter={rank} loop onKeyDown={onKeyDown}>
            <div className="palette-input">
              <span className={`palette-glyph ${urlOrigin ? "url" : ""}`} aria-hidden="true">
                {urlOrigin ? <PlugIcon /> : <MagnifyingGlassIcon />}
              </span>
              <Command.Input
                ref={input}
                value={query}
                onValueChange={(v) => {
                  setQuery(v);
                  if (watching) setWatching(null);
                }}
                placeholder={state.conns.length ? "Search steps, or paste a site URL to connect it" : "Paste a site URL to connect it"}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="palette-esc" onClick={() => entryUi.closePalette()} aria-label="Close">
                <Kbd keys={["esc"]} />
              </button>
            </div>

            {trace ? (
              <ConnectView trace={trace} onGo={() => goToSite(trace.origin)} onReset={reset} onConnect={connect} />
            ) : (
              <Command.List className="palette-list">
                {urlOrigin && (
                  <Command.Group heading="Connect">
                    <ConnectRow origin={urlOrigin} onSelect={() => connect(urlOrigin)} />
                  </Command.Group>
                )}
                {!urlOrigin && (
                  <>
                    <Command.Empty className="palette-empty">
                      {query.trim() ? (
                        <>
                          No step matches “{query.trim()}”. Paste a site's URL to add what it can do.
                        </>
                      ) : (
                        "Paste a site's URL to add what it can do."
                      )}
                    </Command.Empty>
                    {pendingSuggestions.length > 0 && (
                      <Command.Group heading="Suggested sites">
                        {pendingSuggestions.map((o) => (
                          <ConnectRow key={o} origin={o} suggested onSelect={() => connect(o)} />
                        ))}
                      </Command.Group>
                    )}
                    {pendingTemplates.length > 0 && (
                      <Command.Group heading="Learned by Scout">
                        {pendingTemplates.map((t) => (
                          <ConnectRow key={t.origin} origin={t.origin} template={t} onSelect={() => connect(t.origin)} />
                        ))}
                      </Command.Group>
                    )}
                    {model.pendingWrites.length > 0 && (
                      <Command.Group heading="Publish">
                        <Command.Item
                          value="review changes"
                          keywords={["Review changes", "", "publish approve writes", ""]}
                          onSelect={() => {
                            entryUi.closePalette();
                            openReview();
                          }}
                          className="palette-item"
                        >
                          <span className="item-icon">
                            <PaperPlaneTiltIcon />
                          </span>
                          <span className="item-main">
                            <span className="item-title">
                              Review {model.pendingWrites.length} {model.pendingWrites.length === 1 ? "change" : "changes"}
                            </span>
                            <span className="item-sub">Each one is approved on its own site</span>
                          </span>
                          <Kbd keys={["mod", "enter"]} />
                        </Command.Item>
                      </Command.Group>
                    )}
                    {model.siteOrder.map((o) => (
                      <StepGroup key={o} origin={o} />
                    ))}
                    <Command.Group heading="Actions">
                      <Command.Item value="edit the outcome" keywords={["Edit the outcome", "", "outcome title goal", ""]} onSelect={() => entryUi.focusOutcome()} className="palette-item">
                        <span className="item-icon">
                          <TextAlignLeftIcon />
                        </span>
                        <span className="item-main">
                          <span className="item-title">Edit the outcome</span>
                          <span className="item-sub">The outcome picks and orders the steps</span>
                        </span>
                      </Command.Item>
                      {state.conns.length > 0 && (
                        <Command.Item
                          value="copy recipe link"
                          keywords={["Copy recipe link", "", "recipe share save template workspace link", ""]}
                          onSelect={async () => {
                            await navigator.clipboard.writeText(await recipeLink(state, state.host?.agent)).catch(() => {});
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                          }}
                          className="palette-item"
                        >
                          <span className="item-icon">
                            <LinkIcon />
                          </span>
                          <span className="item-main">
                            <span className="item-title">{copied ? "Recipe link copied" : "Copy recipe link"}</span>
                            <span className="item-sub">
                              {cuts.length ? cuts.join(" ") : "The outcome and its sites in one link, without keys, inputs or results. Opening it builds this workspace again, anywhere."}
                            </span>
                          </span>
                        </Command.Item>
                      )}
                    </Command.Group>
                  </>
                )}
              </Command.List>
            )}

            <footer className="palette-foot">
              <span>
                <Kbd keys={["↑"]} />
                <Kbd keys={["↓"]} /> move
              </span>
              {(!trace || isDone(trace)) && (
                <span>
                  <Kbd keys={["enter"]} /> {trace ? "go to step" : urlOrigin ? "connect" : "open"}
                </span>
              )}
              <span>
                <Kbd keys={["esc"]} /> close
              </span>
              <span className="foot-count">
                {state.conns.length} {state.conns.length === 1 ? "site" : "sites"} · {model.refs.length} capabilities
              </span>
            </footer>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </MotionConfig>
  );
}

/**
 * Ranking for the step search: every typed word must appear somewhere; a hit in the title counts
 * most, then the site, then the description. keywords = [title, site name, description, host].
 */
function rank(value: string, search: string, keywords: string[] = []): number {
  const [title = "", site = "", desc = "", host = ""] = keywords.map((k) => k.toLowerCase());
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let score = 0;
  for (const w of words) {
    if (title.split(/\W+/).some((t) => t.startsWith(w))) score += 4;
    else if (title.includes(w)) score += 3;
    else if (site.includes(w) || host.includes(w)) score += 2;
    else if (desc.includes(w) || value.toLowerCase().includes(w)) score += 1;
    else return 0;
  }
  return score / (words.length * 4);
}

/** A "Connect <host>" row: a dashed socket waiting for the site. */
function ConnectRow({ origin, suggested, template, onSelect }: { origin: string; suggested?: boolean; template?: Template; onSelect: () => void }) {
  const host = template ? hostOf(template.target) : hostOf(origin) + new URL(origin).pathname.replace(/^\/$/, "");
  return (
    <Command.Item value={`connect ${origin}`} keywords={[`connect ${host} ${template?.name ?? ""}`, "", "connect a site learned template agent", host]} onSelect={onSelect} className={`palette-item connect-row ${template ? "learned" : ""}`}>
      <span className="socket-mini" aria-hidden="true">
        {template ? <RobotIcon /> : <PlusIcon />}
      </span>
      <span className="item-main">
        <span className="item-title">
          Connect <b>{template ? template.name : host}</b>
          {template && <span className="item-host"> {host}</span>}
        </span>
        <span className="item-sub">
          {template
            ? `${template.skills.length} skills Scout learned (${learnerName(template.learned_by)}). ${host} did not publish them.`
            : suggested
              ? "Suggested by this Mosaic"
              : `Asks you, reads ${host}/agent-manifest.json, then its action bridge`}
        </span>
      </span>
      <Kbd keys={["enter"]} className="item-kbd" />
    </Command.Item>
  );
}

function StepGroup({ origin }: { origin: string }) {
  const { model, actions } = useMosaic();
  const conn = model.connFor(origin)!;
  const n = model.stepOf.get(origin);
  const refs = model.refs.filter((r) => r.origin === origin);
  return (
    <Command.Group heading={`${n} · ${conn.site.site.name}`}>
      {refs.map((r) => (
        <StepItem key={r.key} r={r} hidden={model.hidden.has(r.key)} onSelect={() => {
          entryUi.closePalette();
          jumpTo(r.key, actions.setHot);
        }} />
      ))}
    </Command.Group>
  );
}

function StepItem({ r, hidden, onSelect }: { r: CapRef; hidden: boolean; onSelect: () => void }) {
  const write = r.cap.side_effects === "write";
  return (
    <Command.Item value={r.key} keywords={[r.cap.title, r.siteName, r.cap.description, hostOf(r.origin)]} onSelect={onSelect} className={`palette-item ${hidden ? "is-hidden" : ""}`}>
      <Monogram name={r.siteName} origin={r.origin} />
      <span className="item-main">
        <span className="item-title">{r.cap.title}</span>
        <span className="item-sub">{r.cap.description}</span>
      </span>
      {hidden && <Tag size="sm">Not in plan</Tag>}
      {write ? (
        <Tag tone="warning" size="sm">
          <PencilSimpleIcon /> Changes site
        </Tag>
      ) : null}
    </Command.Item>
  );
}

/** The connect moment: ring of checks, then what the site brought, or a refusal in red. */
function ConnectView({ trace, onGo, onReset, onConnect }: { trace: Trace; onGo: () => void; onReset: () => void; onConnect: (origin: string) => void }) {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const refusal = refusalOf(trace);
  const done = isDone(trace) && !refusal;
  const host = hostOf(trace.origin);
  const conn = model.connFor(trace.origin);
  const status = refusal ? "refused" : done ? "done" : "running";
  return (
    <div className={`connect ${status}`} style={hue(trace.origin)} aria-live="polite">
      <div className="connect-head">
        <Socket trace={trace} />
        <div className="connect-id">
          <span className={`connect-state ${status}`}>{refusal ? "Refused" : done ? "Connected" : "Connecting"}</span>
          <span className="connect-name">{trace.siteName ?? host}</span>
          {trace.siteName && <Origin origin={trace.origin} />}
        </div>
      </div>
      <Checklist trace={trace} />
      {refusal && (
        <div className="refused-box" role="alert">
          <ProhibitIcon className="refused-icon" />
          <div>
            <b>{refusal.headline}</b>
            <p>{refusal.help}</p>
            {refusal.raw && <code>{refusal.raw}</code>}
          </div>
        </div>
      )}
      {refusal?.stage === "network" && trace.choices?.length ? (
        <div className="connect-actions" aria-label="Networks">
          {trace.choices.map((n) => (
            <Button key={n} variant="secondary" onClick={() => onConnect(`${trace.origin}/${n}`)}>
              Connect {n}
            </Button>
          ))}
        </div>
      ) : null}
      {refusal?.stage === "manifest" && state.host?.agent && <TeachBox agent={state.host.agent} url={trace.origin} onLearned={onConnect} />}
      {done && conn && <Gain origin={trace.origin} />}
      <div className="connect-actions">
        {done && (
          <Button variant="primary" icon={<ArrowRightIcon />} side={<Kbd keys={["enter"]} />} onClick={onGo}>
            Go to step {model.stepOf.get(trace.origin) ?? ""}
          </Button>
        )}
        {(done || refusal) && (
          <Button variant="secondary" icon={<PlusIcon />} onClick={onReset}>
            {refusal ? "Try another URL" : "Connect another"}
          </Button>
        )}
        {refusal && conn && (
          <Button
            variant="tertiary"
            onClick={() => {
              actions.disconnect(trace.origin);
              onReset();
            }}
          >
            Remove {host}
          </Button>
        )}
        {!done && !refusal && (
          <>
            <Button variant="tertiary" onClick={() => entryUi.closePalette()}>
              Close
            </Button>
            <span className="hint">Connecting carries on if you close this.</span>
          </>
        )}
      </div>
    </div>
  );
}

/** "+N capabilities from <site>", the number rolling up as the capabilities are dealt in. */
function Gain({ origin }: { origin: string }) {
  const { model } = useMosaic();
  const caps = model.refs.filter((r) => r.origin === origin);
  const name = model.connFor(origin)?.site.site.name ?? hostOf(origin);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(caps.length), 120);
    return () => clearTimeout(t);
  }, [caps.length]);
  return (
    <section className="gain" aria-label={`${caps.length} capabilities from ${name}`}>
      <h3 className="gain-head">
        <span className="gain-num">
          +<NumberFlow value={shown} />
        </span>{" "}
        {caps.length === 1 ? "capability" : "capabilities"} from <span className="gain-name">{name}</span>
      </h3>
      <ul className="gain-caps">
        {caps.map((r, i) => (
          <motion.li
            key={r.key}
            className={`gain-cap ${r.cap.side_effects}`}
            initial={{ opacity: 0, y: 10, rotate: i % 2 ? 1.5 : -1.5 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.12 + i * 0.07, type: "spring", stiffness: 520, damping: 30 }}
          >
            <span className="gain-cap-title">{r.cap.title}</span>
            <span className="gain-cap-kind">{r.cap.side_effects === "write" ? "Changes the site, after approval there" : "Reads only"}</span>
            {model.hidden.has(r.key) && <span className="gain-cap-kind">Not in this outcome's plan</span>}
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

/** The site's monogram in a socket ring. One arc per check; arcs fill as checks pass. */
function Socket({ trace }: { trace: Trace }) {
  const rows = checkRows(trace);
  const refused = !!refusalOf(trace);
  const done = isDone(trace) && !refused;
  const name = trace.siteName ?? hostOf(trace.origin);
  const R = 30;
  const C = 2 * Math.PI * R;
  const gap = 5;
  const seg = C / rows.length;
  return (
    <span className={`socket ${refused ? "refused" : done ? "done" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 72 72" className="socket-ring">
        {rows.map((r, i) => (
          <circle
            key={r.stage}
            className={`arc ${r.state}`}
            cx="36"
            cy="36"
            r={R}
            strokeDasharray={`${seg - gap} ${C - seg + gap}`}
            strokeDashoffset={-i * seg}
            transform="rotate(-90 36 36)"
          />
        ))}
      </svg>
      <span className="socket-core">{refused ? <ProhibitIcon weight="bold" /> : trace.siteName ? monogram(name) : <PlugIcon />}</span>
      {done && (
        <motion.span className="socket-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 22 }}>
          <CheckIcon weight="bold" />
        </motion.span>
      )}
    </span>
  );
}

/** Scout's saved templates, read each time the palette opens. Empty without an agent. */
function useTemplates(agent: string | undefined): Template[] {
  const [list, setList] = useState<Template[]>([]);
  useEffect(() => {
    if (!agent) return;
    let live = true;
    scout.templates(agent).then((t) => live && setList(t), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [agent]);
  return list;
}

/**
 * A site with no manifest: offer to have Scout learn it. Scout opens the site in a browser, turns its
 * forms and tables into skills, runs the reads to check them, and serves the result on its own origin,
 * which is then connected like any other site.
 */
function TeachBox({ agent, url, onLearned }: { agent: string; url: string; onLearned: (origin: string) => void }) {
  const [phase, setPhase] = useState<{ kind: "idle" } | { kind: "learning" } | { kind: "learned"; t: Template } | { kind: "failed"; message: string }>({ kind: "idle" });
  const host = hostOf(url);
  const teach = async () => {
    setPhase({ kind: "learning" });
    try {
      const t = await scout.learn(agent, url);
      setPhase({ kind: "learned", t });
      setTimeout(() => onLearned(t.origin), 1400);
    } catch (e) {
      setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section className={`teach ${phase.kind}`} aria-live="polite">
      <div className="teach-head">
        <RobotIcon weight="bold" className="teach-icon" aria-hidden="true" />
        <div>
          <b>{phase.kind === "learned" ? `Scout learned ${phase.t.skills.length} skills on ${host}` : `Scout can learn ${host}`}</b>
          <p>
            {phase.kind === "learning"
              ? `Opening ${host} in a browser, reading its forms and tables, then trying each read…`
              : phase.kind === "learned"
                ? `Saved as a template (${learnerName(phase.t.learned_by)}). Connecting it now.`
                : `It opens the site in a browser, writes a script for each thing its pages can do, and saves them as a template. ${host} won't have published them, so every change is approved on Scout's sheet.`}
          </p>
        </div>
      </div>
      {phase.kind === "learned" && (
        <ul className="teach-skills">
          {phase.t.skills.map((k) => (
            <li key={k.title} className={k.side_effects}>
              <span>{k.title}</span>
              <span className="teach-kind">{k.side_effects === "write" ? "Changes the site · not run while learning" : k.verified ? "Read · tried, works" : "Read · needs input to try"}</span>
            </li>
          ))}
        </ul>
      )}
      {phase.kind === "failed" && <p className="teach-fail">{phase.message}</p>}
      {(phase.kind === "idle" || phase.kind === "failed") && (
        <Button variant="primary" icon={<RobotIcon />} onClick={teach}>
          {phase.kind === "failed" ? "Try again" : "Teach Scout this site"}
        </Button>
      )}
    </section>
  );
}
