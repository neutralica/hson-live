import type { CompiledHsonSchema } from "./compiler.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { sha256_sync } from "../../core/sha256-sync.js";

/** Identity of the fully validated authored definition, before compiler lowering.
 * Fixed tuple fields: type tag then payload. Object entries are ordered name/value
 * pairs, never JS object keys. Numbers use their exact finite spelling, including -0.
 * No ranges, graph indices, diagnostics, source bytes or compiler limits enter it.
 */
export function schema_definition_identity(compiled: CompiledHsonSchema): Readonly<{ encoding: string; digest: string }> {
  const encode = (value: OrderedProjectedValue): string => {
    if (value === null) return '["null"]';
    if (typeof value === "string") return `["string",${JSON.stringify(value)}]`;
    if (typeof value === "boolean") return `["boolean",${value}]`;
    if (typeof value === "number") return `["number",${JSON.stringify(Object.is(value, -0) ? "-0" : String(value))}]`;
    if (Array.isArray(value)) return `["array",[${value.map(encode).join(",")}]]`;
    if (!is_ordered_projected_object(value)) throw new TypeError("Expected validated ordered Schema definition.");
    return `["object",[${value.entries.map(([name, child]) => `[${JSON.stringify(name)},${encode(child)}]`).join(",")}]]`;
  };
  const encoding = encode(compiled.orderedDefinition);
  return Object.freeze({ encoding, digest: sha256_sync(encoding) });
}
