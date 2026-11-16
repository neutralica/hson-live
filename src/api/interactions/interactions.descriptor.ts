import { validate_document_path } from "../livemap/livemap.document.path.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedObject, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { admit_data_input, hson_data_from_value, hson_data_value, type HsonDataValue } from "../data/hson-data.js";
import type { BrowserInteractionDescriptor, InteractionDescriptor, InteractionListener, InteractionSubject, LocusInteractionDescriptor } from "../../types/interaction.descriptor.types.js";
import type { DocumentCompositionInteraction } from "../livemap/livemap.document.composition.js";
import { encode_event_argument_plan, read_event_argument_plan } from "../../internal/event-argument-plan.js";

export function new_interaction_id(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `event-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

type NormalizedInteractionDescriptor =
  | (Omit<BrowserInteractionDescriptor, "args" | "eventArgs"> & Readonly<{ args?: HsonDataValue; eventArgs?: HsonDataValue }>)
  | (Omit<LocusInteractionDescriptor, "payload" | "eventArgs"> & Readonly<{ payload?: HsonDataValue; eventArgs?: HsonDataValue }>);

export function interaction_descriptor(id: string, subject: InteractionSubject, listener: InteractionListener,
  kind: InteractionDescriptor["kind"], key: string, input: HsonDataValue | undefined,
  eventArgs?: HsonDataValue): NormalizedInteractionDescriptor {
  const common = { id, subject, listener, key, ...(eventArgs === undefined ? {} : { eventArgs }) };
  if (input === undefined) return { ...common, kind };
  return kind === "browser" ? { ...common, kind, args: input } : { ...common, kind, payload: input };
}

/** Normalize a resolved authored attachment through the same Descriptor admission as an imperative edit. */
export function composed_interaction_value(library: string, attachment: DocumentCompositionInteraction): OrderedProjectedObject {
  const { path, listener, kind, key, data, eventArgs } = attachment;
  return descriptor_to_value(interaction_descriptor(new_interaction_id(), { library, path }, listener, kind, key,
    data === undefined ? undefined : hson_data_from_value(data),
    eventArgs === undefined ? undefined : hson_data_from_value(encode_event_argument_plan(eventArgs))));
}

export function descriptor_array(value: OrderedProjectedValue): readonly OrderedProjectedObject[] {
  if (!Array.isArray(value) || value.some((entry) => !is_ordered_projected_object(entry))) {
    throw new Error("Canonical interaction Library state is malformed.");
  }
  return value;
}

export function descriptor_id(value: OrderedProjectedObject): string {
  const id = value.entries.find(([key]) => key === "id")?.[1];
  if (typeof id !== "string") throw new Error("Canonical interaction descriptor ID is malformed.");
  return id;
}

export function interaction_addition(descriptor: InteractionDescriptor): (current: OrderedProjectedValue) => OrderedProjectedValue {
  const value = descriptor_to_value(descriptor);
  const id = descriptor.id;
  return (descriptors) => {
    const current = descriptor_array(descriptors);
    if (current.some((entry) => descriptor_id(entry) === id)) {
      throw new Error(`Canonical interaction ${JSON.stringify(id)} already exists.`);
    }
    return ordered_projected_array([...current, value]);
  };
}

export function descriptor_to_value(descriptor: InteractionDescriptor): OrderedProjectedObject {
  const inputKey = descriptor.kind === "browser" ? "args" : "payload";
  const record = exact_record(descriptor, ["id", "subject", "listener", "kind", "key"], "interaction descriptor", [inputKey, "eventArgs"]);
  const documentSubject = typeof record.subject === "object" && record.subject !== null
    && Object.getOwnPropertyDescriptor(record.subject, "kind")?.value === "document";
  const subject = exact_record(record.subject, documentSubject ? ["library", "kind"] : ["library", "path"], "interaction subject");
  const coordinate: readonly [string, OrderedProjectedValue] = documentSubject
    ? ["kind", "document"] : ["path", ordered_projected_array([...validate_document_path(subject.path)])];
  const listener = exact_record(record.listener, [
    "event", "target", "capture", "once", "passive", "missingTarget",
    "preventDefault", "stopPropagation", "stopImmediatePropagation",
  ], "interaction listener");
  if (documentSubject && listener.target === "element") {
    throw new TypeError("A Document interaction subject cannot use element listener placement.");
  }
  const fields: Array<readonly [string, OrderedProjectedValue]> = [
    ["id", scalar(record.id)],
    ["subject", ordered_projected_object([["library", scalar(subject.library)], coordinate])],
    ["listener", ordered_projected_object(Object.entries(listener).map(([name, value]) => [name, scalar(value)] as const))],
    ["kind", scalar(record.kind)],
    ["key", scalar(record.key)],
  ];
  const input = record[inputKey];
  if (input !== undefined) fields.push([inputKey, hson_data_value(admit_data_input(input))]);
  if (record.eventArgs !== undefined) {
    if (input !== undefined) throw new TypeError("A canonical event argument plan cannot accompany resolved args or payload.");
    const plan = hson_data_value(admit_data_input(record.eventArgs));
    read_event_argument_plan(listener.event, plan);
    fields.push(["eventArgs", plan]);
  }
  return ordered_projected_object(fields);
}

function exact_record(input: unknown, keys: readonly string[], label: string, optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError(`${label} must be an object.`);
  const actual = Reflect.ownKeys(input);
  const fields = [...keys, ...optionalKeys.filter(key => actual.includes(key))];
  if (actual.length !== fields.length || fields.some((key) => !actual.includes(key))) {
    throw new TypeError(`${label} has unknown or missing fields.`);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
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
