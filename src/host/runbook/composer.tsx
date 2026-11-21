// The reply box under Mosaic's agent thread. The outcome at the top names the job; this is where the
// conversation about it goes on: a follow-up after the agent stops, or a line added while a turn
// runs (the runtime reads it before its next model step). Above it, a few next steps Mosaic can
// tell from its own state: go on after approvals, review the changes that wait, retry a failed turn.
import { ArrowClockwiseIcon, ArrowUpIcon, ChecksIcon, NotePencilIcon, PlayIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { entryUi } from "../entry/ui";
import { openReview } from "../review";
import { Button, Kbd } from "../primitives";
import { useMosaic, type State } from "../state";

type Suggestion = { id: string; label: string; icon: React.ReactNode; message?: string; run?: () => void };

/** What Mosaic can offer next, from its own state. Nothing a model wrote. */
export function nextSteps(state: State, pendingWrites: number): Suggestion[] {
  const turn = state.turn;
  if (!turn || turn.status === "running") return [];
  const out: Suggestion[] = [];
  const approved = state.receipts.filter((r) => r.write && r.outcome === "done" && r.at.getTime() >= turn.startedAt);
  if (approved.length) {
    const titles = [...new Set(approved.map((r) => `${r.title} on ${r.siteName}`))];
    out.push({ id: "continue", label: "Continue", icon: <PlayIcon weight="fill" />, message: `I approved ${titles.join(", ")}. Continue with the next step.` });
  }
  if (pendingWrites > 0) {
    out.push({ id: "review", label: `Review ${pendingWrites} ${pendingWrites === 1 ? "change" : "changes"}`, icon: <ChecksIcon weight="bold" />, run: () => openReview() });
  }
  if (turn.status === "failed") out.push({ id: "retry", label: "Try again", icon: <ArrowClockwiseIcon weight="bold" />, message: turn.outcome });
  if (turn.status === "stopped" && !turn.draining) out.push({ id: "resume", label: "Pick up where it stopped", icon: <PlayIcon weight="fill" />, message: "Go on from where you stopped." });
  return out;
}

export function Composer() {
  const { state, model, actions } = useMosaic();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const turn = state.turn;
  const running = turn?.status === "running" && !turn.draining;
  const draining = !!turn?.draining;
  const steps = useMemo(() => nextSteps(state, model.pendingWrites.length), [state, model.pendingWrites.length]);
  if (!turn) return null;

  const send = (text: string) => {
    if (!text.trim()) return;
    if (actions.sendMessage(text)) {
      setDraft("");
      setNote(null);
    } else {
      setNote(running ? "That turn just finished. Send it again to start a follow-up." : "A change is waiting for its approval window. Finish it, then send.");
    }
  };
  const busyReason = draining ? "The stopped turn is still finishing a step" : null;

  return (
    <div className="composer-wrap">
      <AnimatePresence initial={false}>
        {steps.length > 0 && (
          <motion.div className="next-steps" aria-label="Next steps" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {steps.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`next-step ${s.id}`}
                title={s.message ? `Sends: “${s.message}”` : undefined}
                onClick={() => (s.run ? s.run() : s.message && send(s.message))}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className={`composer ${running ? "steering" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="agent-reply" className="sr-only">
          {running ? "Add to this turn" : "Reply to Mosaic's agent"}
        </label>
        <TextareaAutosize
          id="agent-reply"
          ref={box}
          className="composer-input"
          value={draft}
          minRows={1}
          maxRows={6}
          placeholder={running ? "Add to this turn. The agent reads it before its next step." : "Reply to Mosaic's agent…"}
          onChange={(e) => {
            setDraft(e.target.value);
            if (note) setNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="composer-bar">
          <button type="button" className="link-btn composer-new" onClick={() => entryUi.focusOutcome()}>
            <NotePencilIcon aria-hidden="true" /> New outcome
          </button>
          <span className="composer-hint">
            <Kbd keys={["Enter"]} /> to send · <Kbd keys={["Shift", "Enter"]} /> for a new line
          </span>
          <Button type="submit" variant="primary" size="sm" icon={<ArrowUpIcon weight="bold" />} disabledReason={busyReason ?? (!draft.trim() ? "Type a message first" : null)}>
            {running ? "Add" : "Send"}
          </Button>
        </div>
      </form>
      {note && (
        <p className="composer-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
