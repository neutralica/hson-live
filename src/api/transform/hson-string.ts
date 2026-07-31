import { parse_hson } from "./parsers/parse-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonString } from "./transform.types.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";

/**
 * Parse HSON source and return its normalized official default serialization.
 */
export function hsonString(source: string): HsonString {
  return serialize_hson(detach_hson_root_value(parse_hson(source)));
}
