import { project_live_path, snap_live_path, kind_live_path, keys_live_path, length_live_path, snap_live_array_range } from "./livemap.editor.js";
import { part_object_arguments } from "../../core/part-css-authoring.js";
import { is_hson_data_value } from "../data/hson-data.js";
import { must_ordered_projected_value } from "./livemap.guard.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LivePath, LibraryArrayCommands, LibraryObjectCommands, LiveMapArrayMutationName, LiveMapObjectMutationName } from "../../types/livemap.types.js";
import { make_livemap_array_api } from "./livemap.handle-array.js";
import { make_livemap_object_api } from "./livemap.handle-object.js";
import { type LiveMapProjectedPropagation, type LiveMapProjectedPropagationWrite } from "./livemap.projected-propagation.js";

export const ARRAY_COMMANDS = ["push", "pushMany", "unshift", "unshiftMany", "pop", "shift", "clear", "reverse", "sortNumbers", "sortStrings", "splice", "insert", "remove", "replace", "move", "unique", "removeValue", "removeAll"] as const satisfies readonly LiveMapArrayMutationName[];
export const OBJECT_COMMANDS = ["setKey", "setMany", "clear", "deleteKey", "deleteMany", "renameKey"] as const satisfies readonly LiveMapObjectMutationName[];
export type CollectionCommand = Readonly<{
  collection: "array"; method: LiveMapArrayMutationName; args: readonly unknown[];
} | {
  collection: "object"; method: LiveMapObjectMutationName; args: readonly unknown[];
}>;

const captured_key_lists = new WeakSet<readonly string[]>();

/** Capture dense own string slots without using caller methods, iterators, or accessors. */
function capture_object_key_list(input: unknown): readonly string[] {
  if (!Array.isArray(input)) throw new TypeError("LiveMap deleteMany keys must be an array.");
  if (captured_key_lists.has(input)) return input;

  const ownKeys = new Set(Reflect.ownKeys(input));
  const length: unknown = Object.getOwnPropertyDescriptor(input, "length")?.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > 0xffffffff) {
    throw new TypeError("LiveMap deleteMany key list has an invalid array length.");
  }
  if (length >= ownKeys.size) throw new TypeError("LiveMap deleteMany key list must be dense.");
  const keys: string[] = [];
  for (let index = 0; index < length; index++) {
    const slot = String(index);
    const descriptor = ownKeys.has(slot) ? Object.getOwnPropertyDescriptor(input, slot) : undefined;
    if (descriptor === undefined) throw new TypeError(`LiveMap deleteMany key list is missing index ${index}.`);
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`LiveMap deleteMany key list requires an own data property at index ${index}.`);
    }
    const key: unknown = descriptor.value;
    if (typeof key !== "string") throw new TypeError(`LiveMap deleteMany key at index ${index} must be a string.`);
    keys.push(key);
  }
  Object.freeze(keys);
  captured_key_lists.add(keys);
  return keys;
}

function native_operand_type(method: CollectionCommand["method"], index: number): "string" | "number" | undefined {
  switch (method) {
    case "renameKey": return index < 2 ? "string" : undefined;
    case "setKey":
    case "deleteKey":
    case "sortNumbers":
    case "sortStrings": return index === 0 ? "string" : undefined;
    case "move":
    case "splice": return index < 2 ? "number" : undefined;
    case "insert":
    case "remove":
    case "replace": return index === 0 ? "number" : undefined;
    default: return undefined;
  }
}

function capture_collection_argument(method: CollectionCommand["method"], value: unknown, index: number): unknown {
  if (value === undefined) return undefined;
  // Keep native operands intact for helper validation. Data admission would unwrap a HsonDataValue.
  if (is_hson_data_value(value)) {
    const operandType = native_operand_type(method, index);
    if (operandType !== undefined) {
      throw new TypeError(`LiveMap ${method} argument ${index + 1} must be a ${operandType}.`);
    }
  }
  return must_ordered_projected_value(value, []);
}

/** Capture commands only. No installed snapshot is consulted for mutation planning. */
export function collection_commands<TResult>(send: (command: CollectionCommand) => TResult, reject?: (cause: unknown) => TResult, normalize?: (command: CollectionCommand) => CollectionCommand): Readonly<{
  array: LibraryArrayCommands<JsonValue, TResult>; object: LibraryObjectCommands<JsonValue, TResult>;
}> {
  const capture = (command: CollectionCommand): TResult => {
    try {
      // Parts access checks and staged lowering see the same owned key list.
      const keyList = command.method === "deleteMany" ? capture_object_key_list(command.args[0]) : undefined;
      const request = keyList === undefined ? command : { ...command, args: [keyList] };
      const source = normalize?.(request) ?? request;
      const args = Object.freeze(keyList === undefined
        ? source.args.map((value, index) => capture_collection_argument(command.method, value, index))
        : source.args);
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
export function plan_collection_command(root: HsonNode, path: LivePath, command: CollectionCommand): readonly LiveMapProjectedPropagationWrite[] {
  let writes: readonly LiveMapProjectedPropagationWrite[] = [];
  const authority: LiveMapProjectedPropagation<void> = {
    read: path => project_live_path(root, path),
    snap: path => snap_live_path(root, path),
    kind: path => kind_live_path(root, path),
    keys: path => keys_live_path(root, path),
    length: path => length_live_path(root, path),
    arrayRange: (path, bounds) => snap_live_array_range(root, path, bounds),
    feed: () => { throw Error("Collection command planners cannot subscribe."); },
    commit: ops => { writes = ops; },
  };
  if (command.collection === "array") {
    const api = make_livemap_array_api<JsonValue, void>({} as never, path, authority);
    Reflect.apply(api[command.method], undefined, command.args);
  } else {
    const api = make_livemap_object_api<JsonValue, void>({} as never, path, authority);
    Reflect.apply(api[command.method], undefined, command.args);
  }
  return writes;
}

/** Capture omission only for authenticated Parts object authoring commands. */
export function normalize_part_collection_command(command: CollectionCommand, path: LivePath): CollectionCommand {
  if (command.collection !== "object") return command;
  return { ...command, args: part_object_arguments(path, command.method, command.args) };
}
