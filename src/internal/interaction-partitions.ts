import { is_ordered_projected_object, ordered_projected_array, type OrderedProjectedObject,
  type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { validate_interaction_descriptor_ids } from "./interaction-path-maintenance.js";

function member(value: OrderedProjectedObject, name: string): OrderedProjectedValue | undefined {
  return value.entries.find(([key]) => key === name)?.[1];
}

export function interaction_descriptors_from_root(root: OrderedProjectedValue): readonly OrderedProjectedValue[] {
  if (!is_ordered_projected_object(root)) throw new TypeError("Canonical interaction root is malformed.");
  const descriptors = member(root, "descriptors");
  validate_interaction_descriptor_ids(descriptors);
  if (!Array.isArray(descriptors)) throw new TypeError("Canonical interaction descriptors are malformed.");
  return descriptors;
}

export function partition_interaction_descriptors(
  descriptors: OrderedProjectedValue,
  classify: (library: string) => "shared" | "local" | undefined,
): Readonly<{ shared: readonly OrderedProjectedValue[]; local: readonly OrderedProjectedValue[] }> {
  validate_interaction_descriptor_ids(descriptors);
  if (!Array.isArray(descriptors)) throw new TypeError("Canonical interaction descriptors are malformed.");
  const shared: OrderedProjectedValue[] = [];
  const local: OrderedProjectedValue[] = [];
  for (const descriptor of descriptors) {
    if (!is_ordered_projected_object(descriptor)) throw new TypeError("Canonical interaction descriptor is malformed.");
    const subject = member(descriptor, "subject");
    if (!is_ordered_projected_object(subject)) throw new TypeError("Canonical interaction subject is malformed.");
    const library = member(subject, "library");
    if (typeof library !== "string") throw new TypeError("Canonical interaction subject Library is malformed.");
    const partition = classify(library);
    if (partition === undefined) throw new TypeError("Canonical interaction subject must name a document Library.");
    (partition === "shared" ? shared : local).push(descriptor);
  }
  return Object.freeze({ shared: Object.freeze(shared), local: Object.freeze(local) });
}

export function merge_interaction_descriptors(
  shared: readonly OrderedProjectedValue[], local: readonly OrderedProjectedValue[],
): OrderedProjectedValue {
  const merged = ordered_projected_array([...shared, ...local]);
  validate_interaction_descriptor_ids(merged);
  return merged;
}
