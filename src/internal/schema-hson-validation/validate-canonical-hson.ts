import type { HsonCanonical, HsonSchema } from "../../api/transform/transform.types.js";
import type { LiveMapSchema } from "../../api/livemap/livemap.schema.js";
import { LiveMapSchemaError } from "../../api/livemap/livemap.error.js";
import { parse_hson } from "../../api/transform/parsers/parse-hson.js";
import { detach_hson_root_value } from "../../api/transform/utils/node-utils/detach-hson-root-value.js";
import { validate_schema_hson_graph } from "./validate-schema-hson-graph.js";
import { compile_hson_schema } from "../hson-schema/compiler.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";

const COMPILED_HSON_SCHEMAS = new Map<string, ReturnType<typeof compile_hson_schema>>();

/** Shared synchronous canonical boundary. No map construction or certification. */
export function validate_canonical_hson(schema: HsonSchema, canonical: HsonCanonical): HsonCanonical;
export function validate_canonical_hson(schema: LiveMapSchema, canonical: HsonCanonical): HsonCanonical;
export function validate_canonical_hson(schema: LiveMapSchema | HsonSchema, canonical: HsonCanonical): HsonCanonical {
  if (typeof canonical !== "string") throw new TypeError("validate requires an HsonCanonical string.");
  const graph = detach_hson_root_value(parse_hson(canonical));
  if (typeof schema === "string") {
    let compiled = COMPILED_HSON_SCHEMAS.get(schema);
    if (compiled === undefined) {
      compiled = compile_hson_schema(schema);
      COMPILED_HSON_SCHEMAS.set(schema, compiled);
    }
    if (!compiled.ok) throw new LiveMapSchemaError("Hson Schema is unavailable or invalid.", [], compiled.issues.map((issue) => Object.freeze({ code: "INVALID_SCHEMA" as const, path: [], message: issue.message })));
    let projected;
    try { projected = projected_value_from_hson_node(graph); }
    catch { throw new LiveMapSchemaError("Hson Schema validation failed.", [], [Object.freeze({ code: "TYPE_MISMATCH" as const, path: [], message: "Expected data Hson; received document Hson." })]); }
    const result = evaluate_canonical_projected_schema(compiled.value.graph, projected);
    if (!result.ok) throw new LiveMapSchemaError("Hson Schema validation failed.", result.issues[0]?.path ?? [], result.issues.map((issue) => Object.freeze({ code: issue.code, path: issue.path, message: `Schema validation failed at ${issue.path.join(".") || "root"}.`, ...(issue.expected === undefined ? {} : { expected: issue.expected }), ...(issue.received === undefined ? {} : { received: issue.received }) })));
    return canonical;
  }
  const result = validate_schema_hson_graph(schema, graph);
  if (!result.ok) throw new LiveMapSchemaError("Hson Schema validation failed.", result.issues[0]?.path ?? [], result.issues);
  return canonical;
}
