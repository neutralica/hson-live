import { hson } from "../../hson.js";
import { require_document_root_schema } from "../../api/livemap/livemap.document.schema.js";
import { is_owned_projected_schema } from "../../api/livemap/livemap.schema.js";

/** D1 supports this exact runtime instance, not a version-string approximation. */
export function is_trusted_schema_runtime(origin: unknown): boolean {
  return origin === hson;
}

/** Recognition uses the same private registries as the validators, never duck typing. */
export function is_owned_trusted_schema(schema: unknown): schema is object {
  if (is_owned_projected_schema(schema)) return true;
  try { require_document_root_schema(schema); return true; }
  catch { return false; }
}
