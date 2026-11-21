// The event → runbook mapping (src/host/agentic/turn.ts): a turn's trace and stream events become
// peer steps with capability cards, Mosaic's own composer step, visible problems and a summary.
import { describe, expect, test } from "bun:test";
import type { TraceEvent, TurnEvent } from "../src/host/agentic/engine";
import { applyTrace, applyTurnEvent, composerLabel, previewValue, renderedComponents, settleTurn, startTurn, stopTurn, type AgentTurn } from "../src/host/agentic/turn";
import { initialState, reducer } from "../src/host/state/reducer";
import type { State } from "../src/host/state/types";

let seq = 0;
const ev = (phase: TraceEvent["phase"], kind: string, fields: Record<string, unknown> = {}): TraceEvent => ({ phase, kind, seq: seq++, wall: 0, ...fields });
const turnEv = (type: string, fields: Record<string, unknown> = {}): TurnEvent => ({ type, turnId: "s1", id: `${type}:${seq++}`, parentId: "s1", ...fields });
const fold = (events: (TraceEvent | TurnEvent)[], turn: AgentTurn = startTurn("Launch Lumen v1.0")) =>
  events.reduce((t, e) => ("phase" in e ? applyTrace(t, e as TraceEvent) : applyTurnEvent(t, e as TurnEvent)), turn);

/** The demo turn: mosaic → composer, mosaic → pagewright (a website_ read), mosaic → tagforge (a write). */
const DEMO: (TraceEvent | TurnEvent)[] = [
  ev("start", "compile", { id: "s0" }), // before the run: ignored
  ev("start", "run", { id: "s1", input: "Launch Lumen v1.0" }),
  ev("start", "agent", { id: "s2", parent: "s1", agent: "mosaic", network: "mosaic", isTopFrontMan: true }),
  ev("start", "model_call", { id: "s3", parent: "s2", model: "alibaba/qwen3.8-flash", routerHost: "api.otari.ai" }),
  ev("update", "model_call", { id: "s3", parent: "s2", streamChunk: "Planning: " }),
  turnEv("agent.output.delta", { delta: "Planning: ", visibility: "user" }),
  turnEv("agent.output.delta", { delta: "hidden partner text", visibility: "developer" }),
  ev("end", "model_call", { id: "s3", parent: "s2", status: "ok" }),
  ev("start", "tool", { id: "s4", parent: "s2", tool: "composer", args: { request: "Draft release notes for Lumen v1.0" } }),
  ev("start", "agent", { id: "s5", parent: "s4", agent: "composer", network: "mosaic" }),
  ev("note", "agent_result", { parent: "s4", agent: "composer", network: "mosaic", text: "Lumen v1.0 brings a new plugin API." }),
  ev("end", "tool", { id: "s4", parent: "s2", tool: "composer", status: "ok" }),
  ev("start", "tool", { id: "s6", parent: "s2", tool: "pagewright", args: { request: "Preview the docs update" } }),
  ev("start", "remote_call", { id: "s7", parent: "s6", peerOrigin: "localhost:4101", network: "pagewright", brand: "Pagewright", requestPayload: { user_message: { text: "Preview the docs update" }, sly_data: { project: "Lumen" } } }),
  ev("start", "agent", { id: "s8", parent: "s7", agent: "pagewright", network: "pagewright" }),
  ev("start", "tool", { id: "s9", parent: "s8", tool: "website_preview-docs-update", args: { version: "v1.0" } }),
  ev("end", "tool", { id: "s9", parent: "s8", tool: "website_preview-docs-update", status: "ok", resultPreview: '{"status":"succeeded"}' }),
  ev("note", "agent_result", { parent: "s7", agent: "pagewright", network: "pagewright", text: "The docs preview is ready." }),
  ev("end", "remote_call", { id: "s7", parent: "s6", status: "ok", responsePreview: "The docs preview" }),
  ev("end", "tool", { id: "s6", parent: "s2", tool: "pagewright", status: "ok" }),
  ev("start", "compile", { id: "s99" }), // another span outside the run: ignored
];

describe("agent turn mapping", () => {
  test("peer calls become steps, website_ calls become cards, composer is Mosaic's own step", () => {
    const t = fold(DEMO);
    expect(t.runId).toBe("s1");
    expect(t.model).toEqual({ name: "alibaba/qwen3.8-flash", routerHost: "api.otari.ai" });
    expect(t.steps.map((s) => s.kind)).toEqual(["composer", "peer"]);
    const [composer, peer] = t.steps;
    expect(composer).toMatchObject({ kind: "composer", status: "ok", request: "Draft release notes for Lumen v1.0", draft: "Lumen v1.0 brings a new plugin API." });
    expect(composerLabel(composer as never)).toBe('Composer drafted "Lumen v1.0 brings a new plugin API."');
    expect(peer).toMatchObject({ kind: "peer", host: "localhost:4101", network: "pagewright", brand: "Pagewright", request: "Preview the docs update", status: "ok", response: "The docs preview is ready." });
    if (peer?.kind !== "peer") throw new Error("peer");
    expect(peer.cards).toEqual([{ id: "s9", action: "preview-docs-update", input: { version: "v1.0" }, status: "ok", startedAt: 0, preview: '{"status":"succeeded"}', error: undefined }]);
  });

  test("only user-visible text is narration; completion gives the summary", () => {
    const t = fold([...DEMO, turnEv("turn.completed", { result: { text: "Lumen v1.0 is launched." } })]);
    expect(t.narration).toBe("Planning: ");
    expect(t.status).toBe("done");
    expect(t.answer).toBe("Lumen v1.0 is launched.");
  });

  test("budget, cycle, declined and unreachable sites are visible problems", () => {
    const t = fold([
      ...DEMO,
      ev("note", "composition_limit", { parent: "s2", target: "http://localhost:4103/loudhailer", reason: "the per-query limit of 8 third-party calls was reached" }),
      ev("note", "composition_skip", { parent: "s8", target: "http://localhost:4100/mosaic", reason: "already visited in this request" }),
      ev("start", "tool", { id: "s20", parent: "s2", tool: "tagforge", args: { request: "x" } }),
      ev("note", "consent", { parent: "s20", peerOrigin: "localhost:4102", decision: "declined" }),
      ev("end", "tool", { id: "s20", parent: "s2", tool: "tagforge", status: "ok" }),
      ev("start", "tool", { id: "s21", parent: "s2", tool: "inkpost", args: { request: "x" } }),
      ev("end", "tool", { id: "s21", parent: "s2", tool: "inkpost", status: "error", error: "Peer origin http://evil.test is not allowed" }),
    ]);
    const problems = t.steps.filter((s) => s.kind === "problem");
    expect(problems.map((p) => (p.kind === "problem" ? [p.target, p.message] : null))).toEqual([
      ["localhost:4103", "Skipped: the per-query limit of 8 third-party calls was reached"],
      ["localhost:4100", "Skipped: already visited in this request (a cycle)"],
      ["localhost:4102", "You declined to contact localhost:4102. Nothing was sent to it."],
      ["inkpost", "Peer origin http://evil.test is not allowed"],
    ]);
  });

  test("a failed turn shows its error and settles running steps", () => {
    const running = DEMO.slice(0, 15); // pagewright's remote_call is still open
    const t = fold([...running, turnEv("turn.failed", { error: "Mosaic's network failed validation: bad" })]);
    expect(t.status).toBe("failed");
    expect(t.error).toBe("Mosaic's network failed validation: bad");
    expect(t.steps.find((s) => s.kind === "peer")).toMatchObject({ status: "error", error: "Did not finish" });
  });

  test("a failed run span fails the turn even before the stream reports it", () => {
    const t = fold([...DEMO, ev("end", "run", { id: "s1", status: "error", error: "over budget" })]);
    expect(t).toMatchObject({ status: "failed", error: "over budget" });
  });

  test("stop freezes the turn: later events change nothing", () => {
    const stopped = stopTurn(fold(DEMO.slice(0, 15)));
    expect(stopped.status).toBe("stopped");
    expect(stopped.steps.find((s) => s.kind === "peer")).toMatchObject({ status: "error", error: "Stopped" });
    expect(fold(DEMO.slice(15), stopped)).toBe(stopped);
    expect(applyTurnEvent(stopped, turnEv("turn.completed", { result: { text: "late" } }))).toBe(stopped);
  });

  test("events before the run and outside it are ignored", () => {
    const before = startTurn("x");
    expect(applyTrace(before, ev("start", "compile", { id: "c1" }))).toBe(before);
    const t = fold(DEMO);
    expect(applyTrace(t, ev("start", "remote_call", { id: "z1", parent: "elsewhere", peerOrigin: "x" }))).toBe(t);
  });

  test("Stop drains until the runtime settles", () => {
    const stopped = stopTurn(fold(DEMO.slice(0, 15)));
    expect(stopped.draining).toBe(true);
    expect(settleTurn(stopped)).toMatchObject({ status: "stopped", draining: false });
  });

  test("a turn that cannot reach the router says which router, in plain words", () => {
    const t = fold([...DEMO.slice(0, 4), turnEv("turn.failed", { error: "Failed to fetch" })]);
    expect(t.error).toBe("Mosaic could not reach the model router api.otari.ai. Check AI model settings.");
  });

  test("a peer step takes its origin from the files the runtime fetched", () => {
    const t = fold([
      ...DEMO.slice(0, 3),
      ev("start", "remote_call", { id: "p1", parent: "s2", peerOrigin: "docs.example", network: "pagewright", fetchedUrls: ["https://docs.example/agent-manifest.json"], requestPayload: { user_message: { text: "x" } } }),
    ]);
    expect(t.steps[0]).toMatchObject({ kind: "peer", host: "docs.example", origin: "https://docs.example" });
  });

  test("previews parse when complete", () => {
    expect(previewValue('{"a":1}')).toEqual({ a: 1 });
    expect(previewValue('{"a":1, "b": "trunc')).toBe('{"a":1, "b": "trunc');
    expect(previewValue(undefined)).toBeUndefined();
  });

  test("completion keeps the turn id and the widgets Mosaic renders, never actions, html or forms that submit", () => {
    const presentation = {
      version: 1,
      components: [
        { id: "where", kind: "choice", title: "Where?", options: [{ title: "Loudhailer", value: "lh" }] },
        { id: "ok", kind: "confirm", confirmText: "Go on?" },
        { id: "run", kind: "action", action: "website_publish" },
        { id: "raw", kind: "html", html: "<b>x</b>" },
        { id: "pay", kind: "form", schema: { properties: { a: { type: "string" } } }, submit: { actions: ["x"] } },
        { id: "ask", kind: "form", schema: { properties: { a: { type: "string" } } } },
      ],
    };
    const t = fold([...DEMO, turnEv("turn.completed", { turnId: "s1", result: { text: "Pick one.", turnId: "s1", presentation } })]);
    expect(t.status).toBe("done");
    expect(t.turnId).toBe("s1");
    expect(t.components.map((c) => c.id)).toEqual(["where", "ok", "ask"]);
    expect(renderedComponents(null)).toEqual([]);
    expect(renderedComponents({ components: [{ kind: "choice" }] })).toEqual([]); // no id
  });

  test("choice options a model wrote with label, text, name or id still get a title; a choice with none is dropped", () => {
    const [c] = renderedComponents({ components: [{ id: "a", kind: "choice", options: [{ label: "Post now", id: "now" }, { text: "Later" }, "Skip", { name: "Ask me", description: "Hold it" }, {}] }] });
    expect(c!.options).toEqual([
      { title: "Post now", value: "now" },
      { title: "Later", value: "Later" },
      { title: "Skip", value: "Skip" },
      { title: "Ask me", value: "Ask me", subtitle: "Hold it" },
    ]);
    expect(renderedComponents({ components: [{ id: "b", kind: "choice", options: [{}, { meta: "x" }] }] })).toEqual([]);
  });
});

describe("the conversation thread (state/reducer.ts)", () => {
  const done = (outcome: string) => ({ ...startTurn(outcome), status: "done" as const });
  test("a follow-up keeps the earlier turn in the thread; a new outcome starts over", () => {
    let s: State = { ...initialState, turn: done("Launch Lumen v1.0") };
    s = reducer(s, { type: "turn/started", outcome: "Continue", followUp: true });
    expect(s.thread.map((t) => t.outcome)).toEqual(["Launch Lumen v1.0"]);
    expect(s.turn?.outcome).toBe("Continue");
    s = reducer({ ...s, turn: { ...s.turn!, status: "done" } }, { type: "turn/started", outcome: "Pick", followUp: true, interaction: { turnId: "t2", componentId: "where", kind: "choice", value: "lh" } });
    expect(s.thread.map((t) => t.outcome)).toEqual(["Launch Lumen v1.0", "Continue"]);
    expect(s.turn?.interaction?.value).toBe("lh");
    s = reducer(s, { type: "turn/started", outcome: "Announce Atlas v3.0" });
    expect(s.thread).toEqual([]);
    expect(s.turn?.outcome).toBe("Announce Atlas v3.0");
  });
  test("a line added mid-turn joins the running turn only", () => {
    let s = reducer(initialState, { type: "turn/started", outcome: "Launch" });
    s = reducer(s, { type: "turn/steered", text: "Skip the docs" });
    expect(s.turn?.steers).toEqual(["Skip the docs"]);
    s = reducer({ ...s, turn: { ...s.turn!, status: "done" } }, { type: "turn/steered", text: "late" });
    expect(s.turn?.steers).toEqual(["Skip the docs"]);
  });
});
