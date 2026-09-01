import type {
  LocusSchemaDecoder,
  LocusSchemaResult,
  LocusValidator,
} from "../../types/locus.types.js";

function is_schema_result<TValue>(value: unknown): value is LocusSchemaResult<TValue> {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && typeof (value as { ok?: unknown }).ok === "boolean";
}

/** Shared configured-payload decoder used after exact protocol admission. */
export function decode_locus_action_payload<TValue>(
  schema: LocusValidator<TValue> | LocusSchemaDecoder<TValue> | undefined,
  value: unknown,
): LocusSchemaResult<TValue> {
  if (!schema) return { ok: true, value: value as TValue };
  const result = schema(value);
  if (is_schema_result<TValue>(result)) return result;
  if (result === true) return { ok: true, value: value as TValue };
  return { ok: false, issues: ["Value failed Locus schema validation."] };
}

export function locus_schema_error_message(issues: readonly string[]): string {
  return issues.length ? issues.join("; ") : "Value failed Locus schema validation.";
}
