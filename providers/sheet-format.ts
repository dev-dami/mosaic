// How the approval sheet shows a value to a person: Yes/No for booleans, local dates, lists as
// items, Markdown-ish text as lines, long text folded. Pure, so it can be tested without a DOM.
// The sheet renders the result with textContent only: values come from the host page and are
// never parsed as HTML.

export type Line = { kind: "heading" | "item" | "para"; text: string };

export type Shown =
  | { kind: "empty"; text: string }
  | { kind: "bool"; value: boolean; text: "Yes" | "No" }
  | { kind: "date"; text: string; relative: string; iso: string }
  | { kind: "number"; text: string }
  | { kind: "text"; text: string; long: boolean }
  | { kind: "lines"; lines: Line[]; long: boolean }
  | { kind: "list"; items: string[] }
  | { kind: "json"; text: string };

/** Fold text longer than this, or with more lines than FOLD_LINES, behind "Show all". */
export const FOLD_CHARS = 220;
export const FOLD_LINES = 5;

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function relativeTime(target: number, now: number, locale?: string): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["week", 7 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, "minute");
}

/** Split text into heading, item and paragraph lines, dropping blank lines and Markdown markers. */
export function toLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((t): Line => {
      const h = /^#{1,6}\s+(.*)$/.exec(t);
      if (h) return { kind: "heading", text: h[1]! };
      const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(t);
      if (li) return { kind: "item", text: li[1]! };
      return { kind: "para", text: t };
    });
}

export function showValue(value: unknown, now = Date.now(), locale?: string): Shown {
  if (value === undefined || value === null || value === "") return { kind: "empty", text: "Not set" };
  if (typeof value === "boolean") return { kind: "bool", value, text: value ? "Yes" : "No" };
  if (typeof value === "number") return { kind: "number", text: value.toLocaleString(locale) };
  if (typeof value === "string") {
    if (ISO.test(value.trim()) && !Number.isNaN(Date.parse(value))) {
      const t = Date.parse(value);
      const dateOnly = !value.includes("T");
      const text = new Date(t).toLocaleString(locale, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
      return { kind: "date", text, relative: relativeTime(t, now, locale), iso: value };
    }
    if (value.includes("\n") || /^#{1,6}\s/.test(value)) {
      const lines = toLines(value);
      return { kind: "lines", lines, long: lines.length > FOLD_LINES || value.length > FOLD_CHARS * 2 };
    }
    return { kind: "text", text: value, long: value.length > FOLD_CHARS };
  }
  if (Array.isArray(value) && value.every((v) => ["string", "number", "boolean"].includes(typeof v))) {
    return value.length === 0 ? { kind: "empty", text: "None" } : { kind: "list", items: value.map(String) };
  }
  return { kind: "json", text: JSON.stringify(value, null, 2) };
}

/** "post_at" → "Post at", "releaseNotes" → "Release notes": for a field the site gave no title. */
export function humanKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** A value as one comparable string (for the "changed since" word diff). */
export function plainText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Keys whose value differs between two inputs, in the order of `next` then any removed keys. */
export function changedKeys(prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(next), ...Object.keys(prev)])];
  return keys.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}
