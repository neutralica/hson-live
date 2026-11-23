import { formdata_operation } from "./event-argument-plan.js";
import type { PartReference } from "./part-placeholder.js";

/** Event-only connector grammar. This never extends ordinary Part references or calls. */
export function scan_formdata_operation(source: string, start: number,
  observe?: (segment: "sigil" | "root" | "punctuation" | "method" | "field", start: number, end: number, closed?: boolean) => void) {
  if (!source.startsWith("^{formdata:", start)) return undefined;
  const fail = (detail: string): never => { throw new TypeError(`Invalid FormData Event operation. ${detail}`); };
  let at = start + "^{formdata:".length;
  observe?.("sigil", start, start + 1);
  observe?.("punctuation", start + 1, start + 2);
  observe?.("root", start + 2, at - 1);
  observe?.("punctuation", at - 1, at);
  const methodAt = at;
  while (/[A-Za-z]/.test(source[at] ?? "")) at++;
  const method = source.slice(methodAt, at);
  observe?.("method", methodAt, at);
  if (formdata_operation(method, "") === undefined) fail("Use only formdata:get, formdata:getAll, or formdata:has.");
  if (source[at++] !== "(") fail("Expected ( followed by one double-quoted literal field name.");
  observe?.("punctuation", at - 1, at);
  if (source[at] !== '"') fail("Expected one double-quoted literal field name; dynamic or nested arguments are unsupported.");
  const literalAt = at++;
  while (at < source.length && source[at] !== '"') {
    if (source[at] === "\\") at++;
    at++;
  }
  observe?.("field", literalAt, Math.min(at + 1, source.length), at < source.length);
  if (at >= source.length) fail("Unterminated double-quoted field name.");
  let name: unknown;
  try { name = JSON.parse(source.slice(literalAt, ++at)); }
  catch { fail("Field names must use HSON double-quoted string escaping (JSON escapes)."); }
  if (source[at++] !== ")") fail("Expected ) immediately after the single quoted field name; additional arguments are unsupported.");
  observe?.("punctuation", at - 1, at);
  if (source[at++] !== "}") fail("Expected } after the operation; traversal, chaining, and optional operation syntax are unsupported.");
  observe?.("punctuation", at - 1, at);
  const native = formdata_operation(method, name);
  if (native === undefined) return fail("Expected a supported operation with one string field name.");
  // A source site for diagnostics and native-root tooling, never a Part path to resolve.
  const reference: PartReference = { namespace: "local", name: "formdata", path: [], optional: false,
    reference: source.slice(start + 2, at - 1), start, end: at };
  return { ...native, reference };
}
