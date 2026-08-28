import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { LiveMapSchema } from "../../api/livemap/livemap.schema.js";
import { LiveMapSchemaError } from "../../api/livemap/livemap.error.js";
import { parse_hson } from "../../api/transform/parsers/parse-hson.js";
import { detach_hson_root_value } from "../../api/transform/utils/node-utils/detach-hson-root-value.js";
import { validate_schema_hson_graph } from "./validate-schema-hson-graph.js";

/** Shared synchronous canonical boundary. No map construction or certification. */
export function validate_canonical_hson(schema: LiveMapSchema, canonical: HsonCanonical): HsonCanonical {
  if (typeof canonical !== "string") throw new TypeError("validate requires an HsonCanonical string.");
  const graph = detach_hson_root_value(parse_hson(canonical));
  const result = validate_schema_hson_graph(schema, graph);
  if (!result.ok) throw new LiveMapSchemaError("HSON Schema validation failed.", result.issues[0]?.path ?? [], result.issues);
  return canonical;
}
