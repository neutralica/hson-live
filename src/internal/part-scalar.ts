import type { Primitive } from "../core/types.js";
import { part_placeholder_matches, type PartReference, type PartScalarQualifier } from "./part-placeholder.js";

type PartScalarOperand =
  | Readonly<{ kind: "literal"; value: string | number }>
  | Readonly<{ kind: "reference"; reference: PartReference }>
  | Readonly<{ kind: "interpolation"; text: string; references: readonly PartReference[] }>;

/** Classify authored text only. A resolved value never re-enters this grammar. */
export function part_scalar_operand(kind: PartScalarQualifier, text: unknown, literalSigils?: ReadonlySet<number>): PartScalarOperand {
  if (typeof text !== "string") throw new TypeError(`Part :${kind} requires a quoted literal or a Part reference.`);
  let issue: string | undefined;
  const references = part_placeholder_matches(text, message => { issue = message; }, literalSigils);
  if (references === undefined) throw new TypeError(issue);
  const first = references[0];
  if (references.length === 1 && first?.start === 0 && first.end === text.length) return { kind: "reference", reference: first };
  if (kind === "str") return references.length === 0 ? { kind: "literal", value: text } : { kind: "interpolation", text, references };
  if (references.length !== 0) throw new TypeError("Part :num requires a whole reference; numeric interpolation is unsupported.");
  // The end assertion rejects trailing newlines as well as every other non-number character.
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\s\S])/.test(text) ? Number(text) : NaN;
  if (!Number.isFinite(number)) throw new TypeError("Part :num requires a quoted finite JSON number or a whole numeric reference.");
  return { kind: "literal", value: number };
}

export function is_part_scalar_value(kind: PartScalarQualifier, value: unknown): value is string | number {
  return kind === "str" ? typeof value === "string" : typeof value === "number" && Number.isFinite(value);
}

/** Data paths and iteration ordinals require a runtime check. */
export function part_scalar_source_possible(kind: PartScalarQualifier, source: "scalar" | "data" | "doc" | PartScalarQualifier): boolean {
  return source === "scalar" || source === "data" || source === kind;
}

export function interpolate_part_string(text: string, references: readonly PartReference[],
  read: (reference: PartReference) => Primitive | undefined, bound: (length: number) => void): string | undefined {
  let at = 0, result = "", missing = false;
  for (const reference of references) {
    const value = read(reference);
    if (value === undefined) missing = true;
    const replacement = value === undefined ? "" : String(value);
    bound(result.length + reference.start - at + replacement.length);
    result += text.slice(at, reference.start) + replacement;
    at = reference.end;
  }
  bound(result.length + text.length - at);
  return missing ? undefined : result + text.slice(at);
}
