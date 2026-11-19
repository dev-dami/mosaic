// A capability's inputs: each field is either typed by hand or bound to a source (a document
// property, another step's output, or the same field of a read on the same site).
// Two views: the full field rows (InputFields, also used by the review area for writes), and the
// one-line sentence a read block shows until the person edits (InputSentence).
import { FileTextIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { compileForm, type Field } from "../../form";
import { autoBinding, capAnchor, preview, resolve, sameBinding, type Binding, type CapRef } from "../doc";
import { Token, Tooltip } from "../primitives";
import { suggestionsFor, useMosaic } from "../state";
import { Control } from "./controls";
import { setFlow } from "./flow";
import { Markdown } from "./output";

export const fieldId = (r: CapRef, key: string) => `f-${capAnchor(r.key)}-${key}`;
const shortLabel = (f: Field) => f.label.replace(/\s*\(.*\)$/, "");

/**
 * Public: the field rows of one capability. The review area renders a write's inputs with this.
 * `compact` tightens the rows for cards. `only` limits the rows to some field keys.
 */
export function InputFields({ r, compact, only }: { r: CapRef; compact?: boolean; only?: string[] }) {
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const shown = only ? fields.filter((f) => only.includes(f.key)) : fields;
  return (
    <div className={`fields ${compact ? "compact" : ""}`}>
      {shown.map((f) => (
        <FieldRow key={f.key} r={r} field={f} />
      ))}
    </div>
  );
}

export function FieldRow({ r, field }: { r: CapRef; field: Field }) {
  const { state, model, actions } = useMosaic();
  const id = fieldId(r, field.key);
  const binding = model.bindingFor(r.key, field.key);
  const resolved = resolve(binding, model.lookup);
  const raw = state.manual[r.key]?.[field.key] ?? field.initial;
  const auto = binding !== null && sameBinding(binding, autoBinding(r, field.key, model.refs, model.docProps));
  const textish = field.kind === "textarea";
  const empty = typeof raw === "string" && raw.trim() === "";
  // Outputs of other blocks this field could take, offered when it is empty.
  const suggestions = !binding && textish && empty ? suggestionsFor(model, r) : [];
  const srcKey = binding && binding.kind !== "prop" ? binding.cap : null;
  return (
    <div className={`field-row ${binding ? "bound" : ""} ${field.kind}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {field.label}
        {field.required && !binding && (
          <span className="req" aria-label="required">
            *
          </span>
        )}
      </label>
      <div className="field-val">
        {binding ? (
          <div className="bound-val" data-flow-dst={binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined}>
            <div className="bound-line">
              {resolved.state === "value" && field.kind !== "textarea" && field.kind !== "list" && <span className="bound-preview">{preview(resolved.value, 48)}</span>}
              <Token
                info={model.tokenInfo(binding)}
                pending={resolved.state === "pending"}
                onHover={(on) => {
                  actions.setHot(on && srcKey ? srcKey : null);
                  setFlow(on && binding.kind === "output" ? { src: binding.cap, field: binding.field, dst: r.key } : null);
                }}
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
            {field.help && <p className="field-help">{field.help}</p>}
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

/** Does this field still need the person (required, unbound, nothing typed)? */
export function needsPerson(field: Field, binding: Binding | null, raw: string | boolean | undefined): boolean {
  if (!field.required || binding) return false;
  if (field.kind === "boolean") return false;
  return String(raw ?? "").trim() === "";
}

/**
 * The inputs as one sentence of chips: "version v1.0 · highlights 3 items · tone plain".
 * Bound values show where they come from; typed values open their field when clicked.
 * Fields listed in `open` are skipped (they are shown as rows below the sentence).
 */
export function InputSentence({ r, open, onEdit }: { r: CapRef; open: Set<string>; onEdit: (field?: string) => void }) {
  const { state, model, actions } = useMosaic();
  const fields = useMemo(() => compileForm(r.cap.input_schema), [r.cap]);
  const items = fields
    .filter((f) => !open.has(f.key))
    .map((f) => {
      const binding = model.bindingFor(r.key, f.key);
      const raw = state.manual[r.key]?.[f.key] ?? f.initial;
      const res = resolve(binding, model.lookup);
      if (binding && binding.kind !== "prop") {
        const dst = binding.kind === "output" ? `${binding.cap}|${binding.field}` : undefined;
        return (
          <span className="sn-item" key={f.key}>
            <span className="sn-label">{shortLabel(f).toLowerCase()}</span>
            <span className="sn-bound" data-flow-dst={dst}>
              <Token
                info={model.tokenInfo(binding)}
                pending={res.state === "pending"}
                onHover={(on) => {
                  actions.setHot(on ? binding.cap : null);
                  setFlow(on && binding.kind === "output" ? { src: binding.cap, field: binding.field, dst: r.key } : null);
                }}
              />
            </span>
          </span>
        );
      }
      let shown: string;
      if (res.state === "value") shown = res.value;
      else if (f.kind === "list") {
        const n = String(raw).split("\n").filter((x) => x.trim()).length;
        shown = n ? `${n} item${n === 1 ? "" : "s"}` : "";
      } else if (f.kind === "boolean") shown = raw === true ? "Yes" : "No";
      else if (f.kind === "datetime") shown = raw ? String(raw).replace("T", " ") : "now";
      else shown = String(raw);
      if (!shown) return null;
      // A value read from the outcome looks like every other source token: where it comes from, then the value.
      const chip = binding ? (
        <button type="button" className="token doc-tk sn-doc-tk" onClick={() => onEdit(f.key)} aria-label={`${f.label}: ${shown}, from the outcome. Edit`}>
          <FileTextIcon className="tk-doc" aria-hidden="true" />
          <span className="tk-source">Outcome</span>
          <span className="tk-sep">›</span>
          <span className="tk-label">{preview(shown, 28)}</span>
        </button>
      ) : (
        <button type="button" className="sn-chip" onClick={() => onEdit(f.key)} aria-label={`${f.label}: ${shown}. Edit`}>
          {preview(shown, 36)}
        </button>
      );
      return (
        <span className="sn-item" key={f.key}>
          <span className="sn-label">{shortLabel(f).toLowerCase()}</span>
          {binding ? <Tooltip content={`${model.tokenInfo(binding).label}, read from the outcome. Click to type over it.`}>{chip}</Tooltip> : chip}
        </span>
      );
    })
    .filter(Boolean);
  if (items.length === 0 && fields.length > 0 && open.size === fields.length) return null;
  return (
    <div className="sentence">
      {items.length > 0 ? items : <span className="sn-none">No inputs</span>}
      {fields.length > 0 && (
        <button type="button" className="sn-edit" onClick={() => onEdit()} aria-label="Edit inputs">
          <PencilSimpleIcon size={13} />
          <span>Edit</span>
        </button>
      )}
    </div>
  );
}
