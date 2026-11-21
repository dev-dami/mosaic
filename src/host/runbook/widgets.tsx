// The widgets Mosaic's agent returns with an answer (CRUSE, vendor cruse.js): a choice, a confirm, a
// short form, facts, a table or a report, drawn in Mosaic's own controls under the summary. A click
// or a submitted form is the person's next message: it goes back to the agent as a follow-up turn
// with the widget's answer attached, the way the runtime's own UI sends it (vendor ui.js
// renderWidget). Widgets only collect answers; writes still run through the site's approval.
// agentic/turn.ts decides which kinds reach here (RENDERED_KINDS).
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import type { CruseComponent, TurnInteraction } from "../agentic/turn";
import { Button } from "../primitives";
import { useMosaic } from "../state";
import { humanKey, Markdown } from "./output";

type Option = { title?: string; value?: unknown; subtitle?: string; meta?: string };
type FieldSpec = { type?: string; title?: string; description?: string; enum?: unknown[]; items?: { enum?: unknown[] }; default?: unknown };
type Answer = { text: string; data: Record<string, unknown> };
type Values = Record<string, string | boolean | string[]>;

const text = (v: unknown) => (v == null ? "" : String(v));

/**
 * The widgets of one finished turn. `live`: this is the latest turn and nothing has answered it
 * yet; earlier turns keep their widgets visible but locked, showing what was picked.
 */
export function TurnWidgets({ components, turnId, live, answered }: { components: CruseComponent[]; turnId: string; live: boolean; answered?: TurnInteraction }) {
  const { actions } = useMosaic();
  const [sent, setSent] = useState<TurnInteraction | null>(null);
  const picked = answered ?? sent;
  if (!components.length) return null;
  const submit = (c: CruseComponent, a: Answer) => {
    if (!live || picked) return;
    const interaction: TurnInteraction = { turnId, componentId: c.id, kind: c.kind, ...a.data };
    if (actions.sendMessage(a.text, interaction)) setSent(interaction);
  };
  return (
    <div className="widgets" aria-label="Choices from Mosaic's agent">
      {components.map((c, i) => {
        const mine = picked?.componentId === c.id ? picked : null;
        const locked = !live || !!picked;
        return (
          <motion.section
            key={c.id}
            className={`widget ${c.kind} ${locked ? "locked" : ""}`}
            data-component={c.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {(c.title || c.description) && (
              <header className="widget-head">
                {c.title && <h4>{c.title}</h4>}
                {c.description && <p>{c.description}</p>}
              </header>
            )}
            <Widget c={c} locked={locked} picked={mine} onSubmit={(a) => submit(c, a)} />
          </motion.section>
        );
      })}
    </div>
  );
}

function Widget({ c, locked, picked, onSubmit }: { c: CruseComponent; locked: boolean; picked: TurnInteraction | null; onSubmit: (a: Answer) => void }) {
  if (c.kind === "choice") return <Choice c={c} locked={locked} picked={picked} onSubmit={onSubmit} />;
  if (c.kind === "confirm") return <Confirm c={c} locked={locked} picked={picked} onSubmit={onSubmit} />;
  if (c.kind === "form") return <Form c={c} locked={locked} picked={picked} onSubmit={onSubmit} />;
  if (c.kind === "info") {
    const fields = Object.entries((c.fields as Record<string, unknown>) ?? {});
    return (
      <dl className="widget-facts">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt>{humanKey(k)}</dt>
            <dd>{text(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (c.kind === "table") {
    const columns = (c.columns as string[]) ?? [];
    const rows = (c.rows as unknown[][]) ?? [];
    return (
      <div className="widget-table">
        <table>
          <thead>
            <tr>
              {columns.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{text(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (c.kind === "report") return <Markdown source={text(c.markdown)} />;
  return null;
}

function Choice({ c, locked, picked, onSubmit }: { c: CruseComponent; locked: boolean; picked: TurnInteraction | null; onSubmit: (a: Answer) => void }) {
  const options = ((c.options as Option[]) ?? []).filter((o) => o && (o.title || o.value != null));
  const prefix = text(c.choosePrefix) || "I'll go with";
  return (
    <div className="choice-list" role="group" aria-label={c.title || "Choose one"}>
      {options.map((o, i) => {
        const value = o.value ?? o.title;
        const on = !!picked && JSON.stringify(picked.value) === JSON.stringify(value);
        return (
          <button
            key={i}
            type="button"
            className={`choice-opt ${on ? "on" : ""}`}
            aria-pressed={on}
            aria-disabled={locked || undefined}
            onClick={() => !locked && onSubmit({ text: `${prefix}: ${text(o.title ?? o.value)}`, data: { value } })}
          >
            <span className="choice-main">
              <span className="choice-title">{text(o.title ?? o.value)}</span>
              {o.subtitle && <span className="choice-sub">{o.subtitle}</span>}
            </span>
            {o.meta && <span className="choice-meta">{o.meta}</span>}
            <span className="choice-go" aria-hidden="true">
              {on ? <CheckIcon weight="bold" /> : <ArrowRightIcon weight="bold" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Confirm({ c, locked, picked, onSubmit }: { c: CruseComponent; locked: boolean; picked: TurnInteraction | null; onSubmit: (a: Answer) => void }) {
  const yes = text(c.confirmLabel) || "Confirm";
  const no = text(c.cancelLabel) || "Not now";
  return (
    <div className="confirm-row">
      <p className="confirm-text">{text(c.confirmText)}</p>
      {picked ? (
        <span className={`picked-note ${picked.action === "confirm" ? "yes" : "no"}`}>
          <CheckIcon weight="bold" aria-hidden="true" /> You chose “{picked.action === "confirm" ? yes : no}”
        </span>
      ) : (
        <span className="confirm-actions">
          <Button variant="primary" size="sm" disabledReason={locked ? "This question was answered or replaced" : null} onClick={() => onSubmit({ text: text(c.confirmText) || yes, data: { action: "confirm" } })}>
            {yes}
          </Button>
          <Button variant="tertiary" size="sm" disabledReason={locked ? "This question was answered or replaced" : null} onClick={() => onSubmit({ text: text(c.cancelText) || "Not yet, hold off.", data: { action: "cancel" } })}>
            {no}
          </Button>
        </span>
      )}
    </div>
  );
}

function initialValues(props: Record<string, FieldSpec>): Values {
  const out: Values = {};
  for (const [k, f] of Object.entries(props)) {
    if (f.type === "boolean") out[k] = f.default === true;
    else if (f.type === "array") out[k] = Array.isArray(f.default) ? f.default.map(text) : [];
    else out[k] = f.default == null ? "" : text(f.default);
  }
  return out;
}

function Form({ c, locked, picked, onSubmit }: { c: CruseComponent; locked: boolean; picked: TurnInteraction | null; onSubmit: (a: Answer) => void }) {
  const schema = (c.schema as { properties?: Record<string, FieldSpec>; required?: string[] }) ?? {};
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const [values, setValues] = useState<Values>(() => ({ ...initialValues(props), ...((picked?.values as Values) ?? {}) }));
  const set = (k: string, v: string | boolean | string[]) => setValues((old) => ({ ...old, [k]: v }));
  const missing = [...required].filter((k) => {
    const v = values[k];
    return v === "" || v == null || (Array.isArray(v) && v.length === 0);
  });
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (locked || missing.length) return;
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(props)) {
      const v = values[k];
      out[k] = (f.type === "number" || f.type === "integer") && v !== "" ? Number(v) : v;
    }
    const summary = Object.entries(out)
      .filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${props[k]?.title || humanKey(k)}: ${Array.isArray(v) ? v.join(", ") : text(v)}`)
      .join("; ");
    onSubmit({ text: (c.title ? `${c.title}: ` : "") + (summary || "(no details)"), data: { values: out } });
  };
  const base = `w-${c.id}`;
  return (
    <form className="widget-form" onSubmit={send}>
      <fieldset disabled={locked} className="fields">
        {Object.entries(props).map(([k, f]) => {
          const id = `${base}-${k}`;
          const v = values[k];
          const label = f.title || humanKey(k);
          return (
            <div key={k} className="field-row">
              <label className="field-label" htmlFor={id}>
                {label}
                {required.has(k) && (
                  <span className="req" aria-label="required">
                    *
                  </span>
                )}
              </label>
              <div className="field-val">
                {f.type === "boolean" ? (
                  <span className="switch">
                    <input id={id} type="checkbox" checked={v === true} onChange={(e) => set(k, e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                    <span className="switch-text">{v ? "Yes" : "No"}</span>
                  </span>
                ) : f.type === "array" && f.items?.enum ? (
                  <span className="check-group" id={id} role="group" aria-label={label}>
                    {f.items.enum.map((o) => {
                      const on = Array.isArray(v) && v.includes(text(o));
                      return (
                        <label key={text(o)} className={`check-chip ${on ? "on" : ""}`}>
                          <input type="checkbox" checked={on} onChange={() => set(k, on ? (v as string[]).filter((x) => x !== text(o)) : [...((v as string[]) ?? []), text(o)])} />
                          {on && <CheckIcon weight="bold" aria-hidden="true" />}
                          {text(o)}
                        </label>
                      );
                    })}
                  </span>
                ) : f.enum && f.enum.length <= 5 ? (
                  <span className="segmented" id={id} role="radiogroup" aria-label={label}>
                    {f.enum.map((o) => (
                      <label key={text(o)} className={v === text(o) ? "on" : ""}>
                        <input type="radio" name={id} value={text(o)} checked={v === text(o)} onChange={() => set(k, text(o))} />
                        {text(o)}
                      </label>
                    ))}
                  </span>
                ) : f.enum ? (
                  <select id={id} className="inline-input" value={text(v)} onChange={(e) => set(k, e.target.value)}>
                    <option value="">Choose…</option>
                    {f.enum.map((o) => (
                      <option key={text(o)} value={text(o)}>
                        {text(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    className={`inline-input ${f.type === "number" || f.type === "integer" ? "num" : ""}`}
                    type={f.type === "number" || f.type === "integer" ? "number" : "text"}
                    step={f.type === "integer" ? 1 : f.type === "number" ? "any" : undefined}
                    value={text(v)}
                    onChange={(e) => set(k, e.target.value)}
                  />
                )}
                {f.description && <p className="field-help">{f.description}</p>}
              </div>
            </div>
          );
        })}
      </fieldset>
      <div className="widget-form-foot">
        {picked ? (
          <span className="picked-note yes">
            <CheckIcon weight="bold" aria-hidden="true" /> Sent
          </span>
        ) : (
          <Button type="submit" variant="primary" size="sm" disabledReason={locked ? "This question was answered or replaced" : missing.length ? `Fill in ${missing.map((k) => props[k]?.title || humanKey(k)).join(", ")}` : null}>
            {text(c.submitLabel) || "Send"}
          </Button>
        )}
      </div>
    </form>
  );
}
