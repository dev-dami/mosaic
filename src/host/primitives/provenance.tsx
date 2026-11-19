// Host-drawn provenance: the marks that say which site a value or block comes from.
// Sites never draw these themselves, and the host picks each site's hue (src/host/hue.ts).
import { FileTextIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { monogram, originParts } from "../doc";
import { siteHue } from "../hue";
import { useMosaic } from "../state";

/** Returns a function that gives the inline style carrying a site's hue (`--h`). */
export function useHueStyle(): (origin: string) => CSSProperties {
  const { state } = useMosaic();
  return (origin) => ({ "--h": String(state.hues[origin] ?? siteHue(origin)) }) as CSSProperties;
}

export function Monogram({ name, origin, size = "md", ring }: { name: string; origin: string; size?: "sm" | "md" | "lg"; ring?: "running" | "failed" }) {
  const hue = useHueStyle();
  return (
    <span className={`mono-chip ${size} ${ring ? `ring-${ring}` : ""}`} style={hue(origin)} aria-hidden="true">
      {monogram(name)}
    </span>
  );
}

/** An origin with its registrable part at full contrast and the rest muted. */
export function Origin({ origin }: { origin: string }) {
  const { lead, main, tail } = originParts(origin);
  return (
    <span className="origin">
      <span className="dim">{lead}</span>
      {main}
      <span className="dim">{tail}</span>
    </span>
  );
}

/** Monogram, site name and origin in one pill. */
export function Provenance({ name, origin }: { name: string; origin: string }) {
  const hue = useHueStyle();
  return (
    <span className="provenance" style={hue(origin)} title={`Runs on ${origin}`}>
      <Monogram name={name} origin={origin} size="sm" />
      <span className="pv-name">{name}</span>
      <Origin origin={origin} />
    </span>
  );
}

/** Where a bound value comes from. A site token carries the source site's hue; a document token does not. */
export type TokenInfo = { label: string; source: string; origin?: string; siteName?: string };

export function Token(props: { info: TokenInfo; pending?: boolean; onHover?: (on: boolean) => void; onRemove?: () => void; removeLabel?: string }) {
  const { info } = props;
  const hue = useHueStyle();
  return (
    <span
      className={`token ${info.origin ? "site-tk" : "doc-tk"} ${props.pending ? "pending" : ""}`}
      style={info.origin ? hue(info.origin) : undefined}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      {info.origin && info.siteName ? <Monogram name={info.siteName} origin={info.origin} size="sm" /> : <FileTextIcon className="tk-doc" aria-hidden="true" />}
      <span className="tk-source">{info.source}</span>
      <span className="tk-sep">›</span>
      <span className="tk-label">{info.label}</span>
      {props.onRemove && (
        <button type="button" className="tk-x" aria-label={props.removeLabel ?? "Unlink"} onClick={props.onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
