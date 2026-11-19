// Small presentational primitives: Tag, Kbd, Panel, Banner, EmptyFrame, Disclosure.
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState, type HTMLAttributes, type ReactNode } from "react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/** Outline-only label: text and border in the tone colour, no fill. */
export function Tag({ tone = "neutral", size = "md", children, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span {...rest} className={`tag tag--${tone} ${size === "sm" ? "tag--sm" : ""} ${className ?? ""}`}>
      {children}
    </span>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_GLYPHS: Record<string, [mac: string, other: string]> = {
  mod: ["⌘", "Ctrl"],
  alt: ["⌥", "Alt"],
  shift: ["⇧", "Shift"],
  enter: ["↵", "↵"],
  esc: ["Esc", "Esc"],
};

/** Keyboard hint chips with a 2px bottom ledge. `keys={["mod", "K"]}` shows ⌘ K on a Mac, Ctrl K elsewhere. */
export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={`kbd-group ${className ?? ""}`} aria-hidden="true">
      {keys.map((k) => (
        <kbd key={k} className="kbd">
          {KEY_GLYPHS[k.toLowerCase()]?.[isMac ? 0 : 1] ?? k}
        </kbd>
      ))}
    </span>
  );
}

/** A surface card with a 1px line and the hard 3px ledge. */
export function Panel({ as: As = "div", ledge = true, className, children, ...rest }: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "aside"; ledge?: boolean }) {
  return (
    <As {...rest} className={`panel ${ledge ? "panel--ledge" : ""} ${className ?? ""}`}>
      {children}
    </As>
  );
}

/** A status message: what happened and what to do about it. */
export function Banner({ tone = "info", icon, children, actions, className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: Exclude<Tone, "neutral" | "accent">; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div {...rest} className={`banner banner--${tone} ${className ?? ""}`}>
      {icon && <span className="banner-icon">{icon}</span>}
      <div className="banner-body">{children}</div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

/** Empty state: a dashed frame, a title that says what to do, one line of help, one row of actions. */
export function EmptyFrame({ title, children, actions, className }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`empty-frame ${className ?? ""}`}>
      <h2 className="empty-title">{title}</h2>
      {children && <div className="empty-body">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

/** Progressive disclosure: technical detail behind a small toggle. Content is rendered only while open. */
export function Disclosure({ label, openLabel, children, defaultOpen = false, className }: { label: string; openLabel?: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={`disclosure ${className ?? ""}`}>
      <Collapsible.Trigger className="link-btn disclosure-trigger">{open ? (openLabel ?? label) : label}</Collapsible.Trigger>
      <Collapsible.Content className="disclosure-content">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
