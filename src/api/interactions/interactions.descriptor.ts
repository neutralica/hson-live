import { validate_document_path } from "../livemap/livemap.document.path.js";
import { ordered_projected_array, ordered_projected_object, type OrderedProjectedObject, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { admit_data_input, hson_data_from_value, hson_data_value, type HsonDataValue } from "../data/hson-data.js";
import type { InteractionDescriptor } from "../../types/interaction.descriptor.types.js";
import type { DocumentCompositionInteraction } from "../livemap/livemap.document.composition.js";

/** Normalize a resolved authored attachment through the same Descriptor admission as an imperative edit. */
export function composed_interaction_value(library: string, attachment: DocumentCompositionInteraction): OrderedProjectedObject {
  const { path, listener, kind, key, data } = attachment;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const id = `event-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const common = { id, subject: { library, path }, listener, key };
  const argument = hson_data_from_value(data);
  return descriptor_to_value(kind === "browser" ? { ...common, kind, args: argument } : { ...common, kind, payload: argument });
}

export function descriptor_to_value(descriptor: InteractionDescriptor, data?: HsonDataValue): OrderedProjectedObject {
  const kind = exact_record(descriptor, descriptor.kind === "browser"
    ? ["id", "subject", "listener", "kind", "key", "args"]
    : ["id", "subject", "listener", "kind", "key", "payload"], "interaction descriptor");
  const subject = exact_record(kind.subject, ["library", "path"], "interaction subject");
  const path = validate_document_path(subject.path);
  const listener = listener_to_value(kind.listener);
  const common: Array<readonly [string, OrderedProjectedValue]> = [
    ["id", scalar(kind.id)],
    ["subject", ordered_projected_object([["library", scalar(subject.library)], ["path", ordered_projected_array([...path])]])],
    ["listener", listener],
    ["kind", scalar(kind.kind)],
    ["key", scalar(kind.key)],
  ];
  return ordered_projected_object(descriptor.kind === "browser"
    ? [...common, ["args", interaction_data_value(data ?? kind.args)]]
    : [...common, ["payload", interaction_data_value(data ?? kind.payload)]]);
}

function listener_to_value(input: unknown): OrderedProjectedObject {
  const value = exact_record(input, [
    "event", "target", "capture", "once", "passive", "missingTarget",
    "preventDefault", "stopPropagation", "stopImmediatePropagation",
  ], "interaction listener");
  return ordered_projected_object([
    ["event", scalar(value.event)], ["target", scalar(value.target)],
    ["capture", scalar(value.capture)], ["once", scalar(value.once)],
    ["passive", scalar(value.passive)], ["missingTarget", scalar(value.missingTarget)],
    ["preventDefault", scalar(value.preventDefault)],
    ["stopPropagation", scalar(value.stopPropagation)],
    ["stopImmediatePropagation", scalar(value.stopImmediatePropagation)],
  ]);
}

function exact_record(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError(`${label} must be an object.`);
  const actual = Reflect.ownKeys(input);
  if (actual.some((key) => typeof key !== "string") || actual.length !== keys.length
    || keys.some((key) => !actual.includes(key))) throw new TypeError(`${label} has unknown or missing fields.`);
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (property === undefined || !("value" in property) || !property.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties.`);
    }
    output[key] = property.value;
  }
  return output;
}

function scalar(value: unknown): OrderedProjectedValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new TypeError("Canonical interaction scalar field is malformed.");
}

function interaction_data_value(value: unknown): OrderedProjectedValue {
  return hson_data_value(admit_data_input(value));
}
