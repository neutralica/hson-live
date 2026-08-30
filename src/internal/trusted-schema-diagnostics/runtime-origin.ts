import { hson } from "../../hson.js";

/** D1 supports this exact runtime instance, not a version-string approximation. */
export function is_trusted_schema_runtime(origin: unknown): boolean {
  return origin === hson;
}

/** Recognition uses the same private registries as the validators, never duck typing. */
export function is_owned_trusted_schema(schema: unknown): schema is object {
  void schema;
  return false;
}
