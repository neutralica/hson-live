import type { LocusActionDefinitionOptions } from "../../types/locus.types.js";
import type { HsonDataValue } from "../data/hson-data.js";
import { capture_execution_input, execution_input_error, type ExecutionInputContract } from "../../internal/execution-input.js";
import { is_locus_document_action_name } from "./locus.document-actions.js";

export type LocusActionDefinition<THandler> = Readonly<{
  name: string;
  handler: THandler;
  input: ExecutionInputContract | undefined;
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
  return Object.freeze({ name, handler, input: capture_execution_input(options, "Locus action", "action") });
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
  return execution_input_error(contract, value, "Locus action");
}
