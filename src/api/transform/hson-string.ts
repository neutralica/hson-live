import { parse_hson } from "./parsers/parse-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonString } from "./transform.types.js";

/**
 * Parse HSON source and return its normalized official default serialization.
 */
export function hsonString(source: string): HsonString {
  return serialize_hson(parse_hson(source));
}
