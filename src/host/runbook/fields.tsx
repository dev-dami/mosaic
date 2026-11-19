// A capability's inputs: each field is either typed by hand or bound to a source (a document
// property, another step's output, or the same field of a read on the same site).
import { useMemo } from "react";
import { compileForm, type Field } from "../../form";
import { autoBinding, capAnchor, preview, resolve, sameBinding, type CapRef } from "../doc";
import { Token } from "../primitives";
import { suggestionsFor, useMosaic } from "../state";
import { Control, schemaType } from "./controls";
import { Markdown } from "./output";

/**
 * Public: the field rows of one capability. The review area renders a write's inputs with this.
 * `compact` tightens the rows for cards.
 */
export function InputFields({ r, compact }: { r: CapRef; compact?: boolean }) {
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  return (
    <div className={`fields ${compact ? "compact" : ""}`}>
      {fields.map((f) => (
        <FieldRow key={f.key} r={r} field={f} />
      ))}
    </div>
  );
}

export function FieldRow({ r, field }: { r: CapRef; field: Field }) {
  const { state, model, actions } = useMosaic();
  const id = `f-${capAnchor(r.key)}-${field.key}`;
  const binding = model.bindingFor(r.key, field.key);
  const resolved = resolve(binding, model.lookup);
  const raw = state.manual[r.key]?.[field.key] ?? field.initial;
  const isFresh = state.fresh.includes(r.origin);
  const auto = binding !== null && sameBinding(binding, autoBinding(r, field.key, model.refs, model.docProps));
  const textish = field.kind === "textarea";
  const empty = typeof raw === "string" && raw.trim() === "";
  // Outputs of other blocks this field could take, offered when it is empty.
  const suggestions = !binding && textish && empty ? suggestionsFor(model, r) : [];
  const srcKey = binding && binding.kind !== "prop" ? binding.cap : null;
  return (
    <div className={`field-row ${isFresh ? "fresh" : ""} ${binding ? "bound" : ""} ${field.kind}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {field.label}
        {field.required && !binding && (
          <span className="req" aria-label="required">
            *
          </span>
        )}
      </label>
      <div className="field-val">
        {isFresh && (
          <code className="schema-ghost" aria-hidden="true">
            {field.key}: {schemaType(field)}
          </code>
        )}
        {binding ? (
          <div className="bound-val" data-flow-dst={binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined}>
            <div className="bound-line">
              {resolved.state === "value" && field.kind !== "textarea" && field.kind !== "list" && <span className="bound-preview">{preview(resolved.value, 48)}</span>}
              <Token
                info={model.tokenInfo(binding)}
                pending={resolved.state === "pending"}
                onHover={(on) => actions.setHot(on && srcKey ? srcKey : null)}
                onRemove={() => actions.setBinding(r.key, field.key, null)}
                removeLabel={`Type ${field.label} by hand`}
              />
              {resolved.state === "pending" && <span className="bound-preview dim">fills in when that step runs</span>}
              {!auto && <span className="bound-tag">linked by you</span>}
            </div>
            {resolved.state === "value" && (field.kind === "textarea" || field.kind === "list") && (
              <div className="bound-content">
                <Markdown source={resolved.value} />
              </div>
            )}
          </div>
        ) : (
          <>
            <Control field={field} id={id} value={raw} onChange={(v) => actions.setValue(r.key, field.key, v)} />
            {suggestions.length > 0 && (
              <div className="suggestions">
                <span className="dim">Use</span>
                {suggestions.map((b) => {
                  const info = model.tokenInfo(b);
                  return (
                    <button type="button" key={JSON.stringify(b)} className="suggest-btn" aria-label={`Use ${info.siteName} ${info.label}`} onClick={() => actions.setBinding(r.key, field.key, b)}>
                      <Token info={info} />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One input, folded into the block's summary sentence after it has run. */
export function SummaryItem({ r, field }: { r: CapRef; field: Field }) {
  const { state, model, actions } = useMosaic();
  const binding = model.bindingFor(r.key, field.key);
  const raw = state.manual[r.key]?.[field.key] ?? field.initial;
  const res = resolve(binding, model.lookup);
  let shown: string;
  if (binding && binding.kind !== "prop") shown = "";
  else if (res.state === "value") shown = res.value;
  else if (field.kind === "list") {
    const n = String(raw).split("\n").filter((x) => x.trim()).length;
    shown = `${n} item${n === 1 ? "" : "s"}`;
  } else if (field.kind === "boolean") shown = raw === true ? "yes" : "no";
  else if (field.kind === "datetime") shown = raw ? String(raw).replace("T", " ") : "now";
  else shown = String(raw);
  if (!shown && !binding) return null;
  return (
    <span className="sum-item">
      <span className="sum-label">{field.label.replace(/\s*\(.*\)$/, "")}</span>
      {binding && binding.kind !== "prop" ? (
        <span data-flow-dst={binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined}>
          <Token info={model.tokenInfo(binding)} onHover={(on) => actions.setHot(on ? binding.cap : null)} />
        </span>
      ) : (
        <b>{preview(shown, 40)}</b>
      )}
    </span>
  );
}
