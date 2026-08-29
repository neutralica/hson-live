import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import { require_document_root_schema, validate_livemap_document_schema_root } from "../../api/livemap/livemap.document.schema.js";
import { is_owned_projected_schema, validate_livemap_schema_projected_root, type LiveMapSchemaValidation } from "../../api/livemap/livemap.schema.js";
import { is_projected_value_hson_node, projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import type { HsonNode } from "../../core/types.js";

/** Private authority for an exact, already-admitted detached canonical graph.
 * No outer JS materialization, alternative parsing, or LiveMap allocation.
 * Constraint materialization remains inside the existing projected validator.
 */
export function validate_schema_hson_graph(schema: unknown, graph: HsonNode): LiveMapSchemaValidation {
  const projected = is_owned_projected_schema(schema);
  let document: ReturnType<typeof require_document_root_schema> | undefined;
  try { document = require_document_root_schema(schema); } catch { /* capability absence only */ }
  if (!projected && document === undefined) return failure("INVALID_SCHEMA", "a complete-root-capable owned Schema", "unsupported Schema");
  if (is_projected_value_hson_node(graph)) {
    if (projected) return validate_livemap_schema_projected_root(schema, projected_value_from_hson_node(graph));
    return failure("TYPE_MISMATCH", `${document?.node.kind} document root`, "data root");
  }
  const mode = classify_live_root_mode(graph);
  if (document !== undefined && (mode === "element" || mode === "fragment")) {
    return validate_livemap_document_schema_root(document.value, graph, mode);
  }
  return failure("TYPE_MISMATCH", "data root", `${mode} document root`);
}

function failure(code: "INVALID_SCHEMA" | "TYPE_MISMATCH", expected: string, received: string): LiveMapSchemaValidation {
  return { ok: false, issues: [Object.freeze({ code, path: [], message: `Expected ${expected}; received ${received}.`, expected, received })] };
}
