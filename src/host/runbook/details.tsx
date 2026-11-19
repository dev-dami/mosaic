// A step's technical detail, one click away: the full origin, each capability's id, input schema and
// last raw output. Opened from the site chip in the step header; never in the default view.
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon, XIcon } from "@phosphor-icons/react";
import type { CapRef } from "../doc";
import { Disclosure, Monogram, Origin, Tag, useHueStyle } from "../primitives";
import { useMosaic } from "../state";

export function SiteDetails({ origin, name, refs }: { origin: string; name: string; refs: CapRef[] }) {
  const { state, model } = useMosaic();
  const hue = useHueStyle();
  const conn = model.connFor(origin);
  const status = conn?.status ?? "connecting";
  return (
    <Popover.Root>
      <Popover.Trigger className="site-chip" style={hue(origin)} aria-label={`${name} details`}>
        <Monogram name={name} origin={origin} size="sm" ring={status === "connecting" ? "running" : status === "failed" ? "failed" : undefined} />
        <span className="site-chip-name">{name}</span>
        <CaretDownIcon size={12} className="site-chip-caret" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="details-pop" style={hue(origin)} align="end" sideOffset={8} collisionPadding={12}>
          <header className="dp-head">
            <Monogram name={name} origin={origin} size="lg" />
            <div className="dp-id">
              <b>{name}</b>
              <Origin origin={origin} />
            </div>
            <Popover.Close className="dp-close" aria-label="Close">
              <XIcon size={14} />
            </Popover.Close>
          </header>
          {conn?.site.site.description && <p className="dp-desc">{conn.site.site.description}</p>}
          <p className="dp-note">
            {status === "ready" ? "Bridge answered from this origin. Mosaic can call only what the manifest below lists." : status === "failed" ? `Refused: ${conn?.failure ?? "no answer"}` : "Waiting for the site's bridge to answer."}
          </p>
          <ul className="dp-caps">
            {refs.map((r) => {
              const run = state.runs[r.key];
              return (
                <li key={r.key}>
                  <div className="dp-cap-head">
                    <span className="dp-cap-title">{r.cap.title}</span>
                    {r.cap.side_effects === "write" ? <Tag tone="warning" size="sm">Changes {name}</Tag> : <Tag size="sm">Read only</Tag>}
                    {model.hidden.has(r.key) && <Tag size="sm">Not in plan</Tag>}
                  </div>
                  <code className="dp-cap-id">{r.cap.id}</code>
                  <div className="dp-disclose">
                    <Disclosure label="Input schema" openLabel="Hide input schema">
                      <pre className="dp-pre">{JSON.stringify(r.cap.input_schema, null, 2)}</pre>
                    </Disclosure>
                    {run?.status === "done" && (
                      <Disclosure label="Raw output" openLabel="Hide raw output">
                        <pre className="dp-pre">{JSON.stringify(run.output, null, 2)}</pre>
                      </Disclosure>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
