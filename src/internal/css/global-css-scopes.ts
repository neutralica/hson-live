import type { MediaQueryInput, SupportsQueryInput } from "../../types/css.types.js";

export function mediaToAtRule(input: MediaQueryInput): string {
  if (typeof input === "string") {
    const q = input.trim();
    if (!q) throw new Error("GlobalCss.media: empty query");
    return q.startsWith("@media ") ? q : `@media ${q}`;
  }

  const parts: string[] = [];

  const pushPx = (name: string, value?: string | number) => {
    if (value == null) return;
    parts.push(`(${name}: ${typeof value === "number" ? `${value}px` : value})`);
  };

  pushPx("max-width", input.maxWidth);
  pushPx("min-width", input.minWidth);
  pushPx("max-height", input.maxHeight);
  pushPx("min-height", input.minHeight);

  if (input.orientation) parts.push(`(orientation: ${input.orientation})`);
  if (input.hover) parts.push(`(hover: ${input.hover})`);
  if (input.pointer) parts.push(`(pointer: ${input.pointer})`);

  if (parts.length === 0) throw new Error("GlobalCss.media: empty object query");

  return `@media ${parts.join(" and ")}`;
}

/**
 * Convert supports input into an `@supports` rule header.
 *
 * @param input Raw supports condition text or declaration-test map.
 * @returns A normalized `@supports ...` string.
 * @throws If the condition is empty.
 */
export function convertSupportsToAt(input: SupportsQueryInput): string {
  if (typeof input === "string") {
    const q = input.trim();
    if (!q) throw new Error("GlobalCss.supports: empty condition");
    return q.startsWith("@supports ") ? q : `@supports ${q}`;
  }

  const parts = Object.entries(input)
    .map(([k, v]) => {
      if (typeof v === "boolean") return v ? `(${k})` : `not (${k})`;
      return `(${k}: ${String(v)})`;
    });

  if (parts.length === 0) throw new Error("GlobalCss.supports: empty object condition");

  return `@supports ${parts.join(" and ")}`;
}
