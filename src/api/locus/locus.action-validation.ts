import type {
  LocusSchemaDecoder,
  LocusSchemaResult,
  LocusValidator,
} from "../../types/locus.types.js";
import { type HsonDataValue, admit_data_input } from "../data/hson-data.js";
import { hson_data_value } from "../data/hson-data.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { HsonSchema as HsonSchemaHandle, compiled_hson_schema_of } from "../schema/hson-schema.js";
import { compile_hson_schema } from "../../internal/hson-schema/compiler.js";
import { evaluate_canonical_projected_schema } from "../../internal/canonical-schema/evaluate.js";

function is_schema_result<TValue>(value: unknown): value is LocusSchemaResult<TValue> {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && typeof (value as { ok?: unknown }).ok === "boolean";
}

export function decode_locus_action_payload<TValue>(
  schema: HsonSchema | LocusValidator<TValue> | LocusSchemaDecoder<TValue> | undefined,
  value: HsonDataValue | undefined,
): LocusSchemaResult<HsonDataValue | undefined> {
  if (!schema) return { ok: true, value };
  if (schema instanceof HsonSchemaHandle) {
    if (value === undefined) return { ok: false, issues: ["Hson Schema requires present action data."] };
    const compiled = compiled_hson_schema_of(schema);
    if (compiled.graph.capabilities.projectedRoot === undefined) {
      return { ok: false, issues: ["Configured action Hson Schema must compile in data mode."] };
    }
    const evaluated = evaluate_canonical_projected_schema(compiled.graph, hson_data_value(value));
    return evaluated.ok
      ? { ok: true, value }
      : { ok: false, issues: evaluated.issues.map((issue) => (
          `${issue.code} at ${JSON.stringify(issue.path)}`
        )) };
  }
  const result = schema(value === undefined ? undefined : value);
  if (is_schema_result<TValue>(result)) {
    if (!result.ok) return result;
    if (result.value === undefined) return { ok: true, value: undefined };
    try {
      return { ok: true, value: admit_data_input(result.value) };
    } catch {
      return { ok: false, issues: ["Schema decoder output is not canonical Hson data."] };
    }
  }
  if (result === true) return { ok: true, value };
  return { ok: false, issues: ["Value failed Locus schema validation."] };
}

export function locus_schema_error_message(issues: readonly string[]): string {
  return issues.length ? issues.join("; ") : "Value failed Locus schema validation.";
}

/** One application catalog membership rule for validation and execution. @internal */
export function registered_locus_action<TAction>(
  actions: Readonly<Record<string, TAction>> | undefined,
  name: string,
): TAction | undefined {
  if (actions === undefined || !Object.hasOwn(actions, name)) return undefined;
  const action = actions[name];
  return typeof action === "function" ? action : undefined;
}
