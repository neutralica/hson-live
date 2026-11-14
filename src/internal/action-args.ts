import { hson_data_value, type HsonDataInput, type HsonDataValue } from "../api/data/hson-data.js";
import { is_ordered_projected_object } from "../core/ordered-projected-value.js";
import { compiled_hson_schema_of } from "../api/schema/hson-schema.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import { evaluate_canonical_projected_schema } from "./canonical-schema/evaluate.js";
import type { VerifiedCanonicalSchemaGraph } from "./canonical-schema/graph.js";

/** Named arguments may be ordinary Data fields or an exact object carrier. */
export type ActionArgsInput = Readonly<Record<string, Exclude<HsonDataInput, HsonDataValue>>> | HsonDataValue;

export type ActionArgsOptions = Readonly<{
  args?: Readonly<{
    /** Defaults to false, including when a Schema is supplied. */
    required?: boolean;
    /** A public Hson Schema handle compiled in Data mode. */
    schema?: HsonSchema;
  }>;
}>;

export type ActionArgsContract = Readonly<{
  required: boolean;
  schema: VerifiedCanonicalSchemaGraph | undefined;
}>;

/** Capture the same immutable Data contract for hosted and local actions. */
export function capture_action_args(
  options: ActionArgsOptions | undefined, label: string, schemaLabel: string,
): ActionArgsContract | undefined {
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options)
    || Reflect.ownKeys(options).some(key => key !== "args"))) {
    throw new TypeError(`${label} options may contain only args.`);
  }
  const args = options !== undefined && Object.hasOwn(options, "args") ? options.args : undefined;
  if (args === undefined) return undefined;
  if (typeof args !== "object" || args === null || Array.isArray(args)
    || Reflect.ownKeys(args).some(key => key !== "required" && key !== "schema")) {
    throw new TypeError(`${label} args options may contain only required and schema.`);
  }
  const required = Object.hasOwn(args, "required") ? args.required : undefined;
  if (required !== undefined && typeof required !== "boolean") {
    throw new TypeError(`${label} args.required must be a boolean.`);
  }
  const schema = Object.hasOwn(args, "schema") ? args.schema : undefined;
  const graph = schema === undefined ? undefined : compiled_hson_schema_of(schema).graph;
  if (graph !== undefined && graph.capabilities.projectedRoot === undefined) {
    throw new TypeError(`Configured ${schemaLabel} Hson Schema must compile in data mode.`);
  }
  return Object.freeze({ required: required === true, schema: graph });
}

/** Check presence separately from Schema evaluation, using the exact Data carrier. */
export function action_args_error(
  contract: ActionArgsContract | undefined, value: HsonDataValue | undefined, label: string,
): string | undefined {
  if (value === undefined) return contract?.required ? `${label} requires arguments.` : undefined;
  const data = hson_data_value(value);
  if (!is_ordered_projected_object(data)) return `${label} arguments must be a Data object with named fields.`;
  if (contract?.schema === undefined) return undefined;
  const evaluated = evaluate_canonical_projected_schema(contract.schema, data);
  return evaluated.ok ? undefined : evaluated.issues.map(issue => `${issue.code} at ${JSON.stringify(issue.path)}`).join("; ");
}
