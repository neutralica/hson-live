import { parse_ordered_json_text } from "./exact-data-codec.js";
import { parse_canonical_hson_data } from "./hson-data-canonical-codec.js";
import type { OrderedProjectedValue } from "./ordered-projected-value.js";
import { assert_canonical_hson_data_value } from "./projected-value-graph.js";

/**
 * Admit serialized JSON or Hson Data into the existing immutable ordered carrier.
 *
 * The shared grammar (primitives, JSON-escaped strings, and square arrays of
 * those values) has identical semantics. The JSON grammar also recognizes brace
 * objects, including inside arrays. Only a syntax miss delegates to the Hson
 * grammar for angles, guillemets, trailing array commas, content layout or trivia.
 * This uses the parsers themselves for recognition, without a second scanner or
 * a semantic preference between notations. Neither grammar admits hybrids.
 *
 * Semantic failures from either parser are final. In particular, the common
 * Data-only qualification runs outside the syntax-recognition catch: structural
 * JSON envelopes are ordinary reserved Data members, never instructions.
 * No source notation or parsed graph is retained alongside the returned carrier.
 * @internal
 */
export function admit_data_source(source: string): OrderedProjectedValue {
  let value: OrderedProjectedValue;
  try {
    value = parse_ordered_json_text(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    value = parse_canonical_hson_data(source);
  }
  assert_canonical_hson_data_value(value);
  return value;
}
