// parse-style.ts

import { kebab_to_camel } from "../primitive-utils/kebab-to-camel.util.js";

/*******
 * Parse a CSS declaration list string into a key/value record.
 *
 * Purpose:
 * - Converts a raw `style=""` string (e.g. `color: red; --x: 1;`) into a
 *   plain object mapping properties to their raw value strings.
 *
 * Parsing rules:
 * - Splits declarations on `;` only when not inside quotes and not inside
 *   parentheses (so `url(...)` and quoted strings are preserved).
 * - Within each declaration, splits on the first `:` that is outside quotes
 *   and parentheses.
 * - Ignores empty/whitespace-only fragments and fragments without a `:`.
 *
 * Key normalization:
 * - Custom properties (`--foo`) are preserved verbatim as keys.
 * - Non-custom properties are lowercased and converted from kebab-case to
 *   camelCase via `kebab_to_camel` (e.g. `background-color` → `backgroundColor`).
 *
 * Value handling:
 * - Values are returned trimmed, but otherwise unchanged (no unquoting,
 *   no escaping, no validation).
 *
 * Caveats:
 * - Does not attempt to parse nested CSS, comments, or malformed strings
 *   beyond the safe delimiter logic described above.
 * - Duplicate keys are overwritten by the last occurrence.
 *
 * @param input - Raw CSS declaration list, typically from an HTML `style` attribute.
 * @returns Record of parsed CSS properties to raw value strings.
 *******/
export function parse_style_string(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;

  let buf = "";
  let inQuotes = false;
  let quote: '"' | "'" | null = null;
  let parenDepth = 0;

  const flushDecl = () => {
    const s = buf.trim();
    buf = "";
    if (!s) return;

    // split on first ":" outside quotes/parentheses
    let i = 0, k = -1;
    let q = null as '"' | "'" | null;
    let dq = false, depth = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (q) { if (ch === q) q = null; i++; continue; }
      if (ch === '"' || ch === "'") { q = ch as '"' | "'"; i++; continue; }
      if (ch === "(") { depth++; i++; continue; }
      if (ch === ")") { if (depth) depth--; i++; continue; }
      if (ch === ":" && depth === 0) { k = i; break; }
      i++;
    }
    if (k === -1) return;

    const rawKey = s.slice(0, k).trim();
    const rawVal = s.slice(k + 1).trim();
    if (!rawKey) return;

    const isCustomProp = rawKey.startsWith("--");
    const key = isCustomProp
      ? rawKey // preserve verbatim for custom properties
      : kebab_to_camel(rawKey.toLowerCase()); // normal props: lower → camel

    const val = rawVal.trim();
    out[key] = val;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === quote) { inQuotes = false; quote = null; }
      buf += ch; continue;
    }
    if (ch === '"' || ch === "'") { inQuotes = true; quote = ch as any; buf += ch; continue; }
    if (ch === "(") { parenDepth++; buf += ch; continue; }
    if (ch === ")") { if (parenDepth) parenDepth--; buf += ch; continue; }
    if (ch === ";" && parenDepth === 0) { flushDecl(); continue; }
    buf += ch;
  }
  flushDecl();

  return out;
}
