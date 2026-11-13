import { hson_data_value, type HsonDataValue } from "../api/data/hson-data.js";
import { compiled_hson_schema_of } from "../api/schema/hson-schema.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import { evaluate_canonical_projected_schema } from "./canonical-schema/evaluate.js";
import type { VerifiedCanonicalSchemaGraph } from "./canonical-schema/graph.js";

export type ExecutionInputOptions = Readonly<{
  input?: Readonly<{
    /** Defaults to false, including when a Schema is supplied. */
    required?: boolean;
    /** A public Hson Schema handle compiled in Data mode. */
    schema?: HsonSchema;
  }>;
}>;

export type ExecutionInputContract = Readonly<{
  required: boolean;
  schema: VerifiedCanonicalSchemaGraph | undefined;
}>;

/** Capture the same immutable Data contract for hosted and local actions. */
export function capture_execution_input(
  options: ExecutionInputOptions | undefined, label: string, schemaLabel: string,
): ExecutionInputContract | undefined {
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options)
    || Reflect.ownKeys(options).some(key => key !== "input"))) {
    throw new TypeError(`${label} options may contain only input.`);
  }
  const input = options !== undefined && Object.hasOwn(options, "input") ? options.input : undefined;
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Reflect.ownKeys(input).some(key => key !== "required" && key !== "schema")) {
    throw new TypeError(`${label} input options may contain only required and schema.`);
  }
  const required = Object.hasOwn(input, "required") ? input.required : undefined;
  if (required !== undefined && typeof required !== "boolean") {
    throw new TypeError(`${label} input.required must be a boolean.`);
  }
  const schema = Object.hasOwn(input, "schema") ? input.schema : undefined;
  const graph = schema === undefined ? undefined : compiled_hson_schema_of(schema).graph;
  if (graph !== undefined && graph.capabilities.projectedRoot === undefined) {
    throw new TypeError(`Configured ${schemaLabel} Hson Schema must compile in data mode.`);
  }
  return Object.freeze({ required: required === true, schema: graph });
}

/** Check presence separately from Schema evaluation, using the exact Data carrier. */
export function execution_input_error(
  contract: ExecutionInputContract | undefined, value: HsonDataValue | undefined, label: string,
): string | undefined {
  if (value === undefined) return contract?.required ? `${label} requires input.` : undefined;
  if (contract?.schema === undefined) return undefined;
  const evaluated = evaluate_canonical_projected_schema(contract.schema, hson_data_value(value));
  return evaluated.ok ? undefined : evaluated.issues.map(issue => `${issue.code} at ${JSON.stringify(issue.path)}`).join("; ");
}
