import type { LocusActionDefinitionOptions } from "../../types/locus.types.js";
import { type HsonDataValue, hson_data_value } from "../data/hson-data.js";
import { compiled_hson_schema_of } from "../schema/hson-schema.js";
import { evaluate_canonical_projected_schema } from "../../internal/canonical-schema/evaluate.js";
import { is_locus_document_action_name } from "./locus.document-actions.js";

export type LocusActionDefinition<THandler> = Readonly<{
  name: string;
  handler: THandler;
  input: Readonly<{
    required: boolean;
    schema: ReturnType<typeof compiled_hson_schema_of>["graph"] | undefined;
  }> | undefined;
}>;

export type LocusActionRegistration<THandler> = THandler | (LocusActionDefinitionOptions & Readonly<{ handler: THandler }>);

/** Both startup and additive registration capture the executable and its Data contract here. */
export function capture_locus_action_definition<THandler>(
  name: string,
  handler: THandler,
  options?: LocusActionDefinitionOptions,
): LocusActionDefinition<THandler> {
  if (typeof name !== "string" || name.length === 0) throw new TypeError("Locus action name must be a nonempty string.");
  if (is_locus_document_action_name(name)) throw new TypeError(`Locus action ${JSON.stringify(name)} is reserved for a built-in document action.`);
  if (typeof handler !== "function") throw new TypeError(`Locus action ${JSON.stringify(name)} requires an executable handler.`);
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options)
    || Reflect.ownKeys(options).some(key => key !== "input"))) {
    throw new TypeError("Locus action options may contain only input.");
  }
  const input = options !== undefined && Object.hasOwn(options, "input") ? options.input : undefined;
  if (input === undefined) return Object.freeze({ name, handler, input: undefined });
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Reflect.ownKeys(input).some(key => key !== "required" && key !== "schema")) {
    throw new TypeError("Locus action input options may contain only required and schema.");
  }
  const required = Object.hasOwn(input, "required") ? input.required : undefined;
  if (required !== undefined && typeof required !== "boolean") {
    throw new TypeError("Locus action input.required must be a boolean.");
  }
  const schema = Object.hasOwn(input, "schema") ? input.schema : undefined;
  const graph = schema === undefined ? undefined : compiled_hson_schema_of(schema).graph;
  if (graph !== undefined && graph.capabilities.projectedRoot === undefined) {
    throw new TypeError("Configured action Hson Schema must compile in data mode.");
  }
  return Object.freeze({ name, handler, input: Object.freeze({ required: required === true, schema: graph }) });
}

export function capture_locus_action_definitions<THandler extends (...args: never[]) => unknown>(
  actions: Readonly<Record<string, LocusActionRegistration<THandler> | undefined>> | undefined,
): readonly LocusActionDefinition<THandler>[] {
  if (actions === undefined) return Object.freeze([]);
  if (typeof actions !== "object" || actions === null || Array.isArray(actions)) {
    throw new TypeError("Locus actions must be a keyed collection.");
  }
  return Object.freeze(Object.entries(actions).map(([name, definition]) => {
    if (typeof definition === "function") return capture_locus_action_definition(name, definition);
    if (typeof definition !== "object" || definition === null || !Object.hasOwn(definition, "handler")) {
      throw new TypeError(`Locus action ${JSON.stringify(name)} requires an executable handler.`);
    }
    if (Reflect.ownKeys(definition).some(key => key !== "handler" && key !== "input")) {
      throw new TypeError("Locus action definitions may contain only handler and input.");
    }
    return capture_locus_action_definition(name, definition.handler,
      Object.hasOwn(definition, "input") ? { input: definition.input } : undefined);
  }));
}

/** Evaluate present input against the compiled Schema on its exact Data carrier. */
export function locus_action_input_error(
  contract: LocusActionDefinition<unknown>["input"],
  value: HsonDataValue | undefined,
): string | undefined {
  if (value === undefined) return contract?.required ? "Locus action requires input." : undefined;
  if (contract?.schema === undefined) return undefined;
  const evaluated = evaluate_canonical_projected_schema(contract.schema, hson_data_value(value));
  return evaluated.ok ? undefined : evaluated.issues.map(issue => `${issue.code} at ${JSON.stringify(issue.path)}`).join("; ");
}
