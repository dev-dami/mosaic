// Input controls compiled from a capability's JSON Schema (see src/form.ts).
import { useId, useState } from "react";
import type { Field } from "../../form";
import { Markdown } from "./output";

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function Control({ field, id, value, onChange }: { field: Field; id: string; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const [previewing, setPreviewing] = useState(false);
  const groupId = useId();
  switch (field.kind) {
    case "boolean":
      return (
        <label className="switch">
          <input id={id} type="checkbox" role="switch" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-text">{value === true ? "Yes" : "No"}</span>
        </label>
      );
    case "select":
      if (field.options.length <= 4) {
        return (
          <div className="segmented cap-text" role="radiogroup" aria-labelledby={`${id}-label`}>
            {field.options.map((o) => (
              <label key={o} className={value === o ? "on" : ""}>
                <input type="radio" name={groupId} value={o} checked={value === o} onChange={() => onChange(o)} />
                {o}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select id={id} className="inline-input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "datetime": {
      const now = new Date();
      const inHour = new Date(now.getTime() + 3600_000);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
      const presets = [
        { label: "Now", value: "" },
        { label: "In 1 hour", value: localInput(inHour) },
        { label: "Tomorrow 09:00", value: localInput(tomorrow) },
      ];
      const custom = value !== "" && !presets.some((p) => p.value === value);
      return (
        <div className="datetime">
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
            {presets.map((p) => (
              <label key={p.label} className={value === p.value ? "on" : ""}>
                <input type="radio" name={groupId} checked={value === p.value} onChange={() => onChange(p.value)} />
                {p.label}
              </label>
            ))}
            <label className={custom ? "on" : ""}>
              <input type="radio" name={groupId} checked={custom} onChange={() => onChange(localInput(new Date(tomorrow.getTime() + 3600_000)))} />
              Pick…
            </label>
          </div>
          {value !== "" && (
            <input id={id} type="datetime-local" className="inline-input when" value={String(value)} onChange={(e) => onChange(e.target.value)} />
          )}
        </div>
      );
    }
    case "textarea":
      return (
        <div className="md-editor">
          {previewing ? (
            <div className="md-preview">{String(value).trim() ? <Markdown source={String(value)} /> : <span className="muted">Nothing to preview</span>}</div>
          ) : (
            <textarea id={id} className="inline-input" rows={4} value={String(value)} placeholder="Write in markdown" onChange={(e) => onChange(e.target.value)} />
          )}
          <button type="button" className="md-toggle" onClick={() => setPreviewing((p) => !p)}>
            {previewing ? "Edit" : "Preview"}
          </button>
        </div>
      );
    case "list":
      return <textarea id={id} className="inline-input list" rows={3} value={String(value)} placeholder="One per line" onChange={(e) => onChange(e.target.value)} />;
    case "json":
      return <textarea id={id} className="inline-input json" rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
    case "text":
    case "number":
    case "integer":
      return (
        <input
          id={id}
          className={`inline-input ${field.kind !== "text" ? "num" : ""}`}
          inputMode={field.kind === "text" ? undefined : "decimal"}
          value={String(value)}
          placeholder={field.required ? "Required" : "Optional"}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export const schemaType = (field: Field) =>
  ({ text: "string", textarea: "string", number: "number", integer: "integer", boolean: "boolean", select: "enum", list: "string[]", json: "object", datetime: "date-time" })[field.kind];
