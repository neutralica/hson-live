import { must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import type { JsonValue } from "../../core/types.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import type { LivePath, LibraryArrayCommands, LibraryObjectCommands, LiveMapArrayMutationName, LiveMapObjectMutationName } from "../../types/livemap.types.js";
import { make_livemap_array_api } from "./livemap.handle-array.js";
import { make_livemap_object_api } from "./livemap.handle-object.js";
import type { LiveMapProjectedPropagation, LiveMapProjectedPropagationWrite } from "./livemap.projected-propagation.js";

export const ARRAY_COMMANDS = ["push", "pushMany", "unshift", "unshiftMany", "pop", "shift", "clear", "reverse", "sortNumbers", "sortStrings", "splice", "insert", "remove", "replace", "move", "unique", "removeValue", "removeAll"] as const satisfies readonly LiveMapArrayMutationName[];
export const OBJECT_COMMANDS = ["setKey", "setMany", "clear", "deleteKey", "deleteMany", "renameKey"] as const satisfies readonly LiveMapObjectMutationName[];
export type CollectionCommand = Readonly<{
  collection: "array"; method: LiveMapArrayMutationName; args: readonly unknown[];
} | {
  collection: "object"; method: LiveMapObjectMutationName; args: readonly unknown[];
} | {
  collection: "array" | "object"; method: "assert-shape"; args: readonly [];
}>;

/** Capture commands only. No installed snapshot is consulted for mutation planning. */
export function collection_commands<TResult>(send: (command: CollectionCommand) => TResult, reject?: (cause: unknown) => TResult): Readonly<{
  array: LibraryArrayCommands<JsonValue, TResult>; object: LibraryObjectCommands<JsonValue, TResult>;
}> {
  const capture = (command: Exclude<CollectionCommand, { method: "assert-shape" }>): TResult => {
    try {
      const args = Object.freeze(command.args.map(value => value === undefined ? undefined : must_ordered_projected_value(value, [])));
      return send(Object.freeze({ ...command, args }));
    } catch (cause) {
      if (reject !== undefined) return reject(cause);
      throw cause;
    }
  };
  const array = Object.fromEntries(ARRAY_COMMANDS.map(method => [method, (...args: unknown[]) =>
    capture({ collection: "array", method, args })]));
  const object = Object.fromEntries(OBJECT_COMMANDS.map(method => [method, (...args: unknown[]) =>
    capture({ collection: "object", method, args })]));
  // The finite method lists above implement exactly the existing command signatures.
  return Object.freeze({ array: Object.freeze(array), object: Object.freeze(object) }) as unknown as Readonly<{
    array: LibraryArrayCommands<JsonValue, TResult>; object: LibraryObjectCommands<JsonValue, TResult>;
  }>;
}

/** Run the established helpers over the progressively updated candidate. */
export function plan_collection_command(value: OrderedProjectedValue, path: LivePath, command: CollectionCommand): readonly LiveMapProjectedPropagationWrite[] {
  let writes: readonly LiveMapProjectedPropagationWrite[] = [];
  const authority: LiveMapProjectedPropagation<void> = {
    read: target => ordered_projected_value_at(value, target),
    feed: () => { throw Error("Collection command planners cannot subscribe."); },
    commit: ops => { writes = ops; },
  };
  if (command.collection === "array") {
    const api = make_livemap_array_api<JsonValue, void>({} as never, path, authority);
    if (command.method === "assert-shape") {
      if (!api.is()) throw path_kind_error(path, command.collection);
    } else Reflect.apply(api[command.method], undefined, command.args);
  } else {
    const api = make_livemap_object_api<JsonValue, void>({} as never, path, authority);
    if (command.method === "assert-shape") {
      if (!api.is()) throw path_kind_error(path, command.collection);
    } else Reflect.apply(api[command.method], undefined, command.args);
  }
  return writes;
}
