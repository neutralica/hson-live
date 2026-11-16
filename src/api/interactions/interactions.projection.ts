import { validate_interaction_subjects } from "../../internal/interaction-path-maintenance.js";
import { compiled_hson_schema_of, HsonSchema } from "../schema/hson-schema.js";
import type { HsonNode } from "../../core/types.js";
import { projected_value_from_hson_node, projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { evaluate_canonical_projected_fields } from "../../internal/canonical-schema/evaluate.js";
import { interaction_descriptors_from_root } from "../../internal/interaction-partitions.js";
import { validate_descriptor_event_plan } from "../../internal/event-argument-plan.js";

function interaction_schema(): HsonSchema {
  // Exact subject alternatives and cross-field placement are checked below.
  const common = `id "string" subject <content <library "string" path <optional <array <number <int true min 0>>>> kind <optional <exact "document">>>>
    listener <content <event "string" target <union [<exact "element">, <exact "document">, <exact "window">]>
      capture "boolean" once "boolean" passive "boolean" missingTarget <union [<exact "ignore">, <exact "warn">, <exact "throw">]>
      preventDefault "boolean" stopPropagation "boolean" stopImmediatePropagation "boolean">>`;
  return HsonSchema.fromHson(`<type "data" content <descriptors <array <union [
    <content <${common} kind <exact "browser"> key "string" args <optional "any"> eventArgs <optional <array <array "any">>>>>,
    <content <${common} kind <exact "locus"> key "string" payload <optional "any"> eventArgs <optional <array <array "any">>>>>
  ]>>>>`);
}

// The registry digest fences the complete current canonical representation.
const INTERACTION_SCHEMA = interaction_schema();
const INTERACTION_STATE_SCHEMA = INTERACTION_SCHEMA;

/** Stable reserved system binding used in registry and durability fences. @internal */
export function interaction_schema_internal(): HsonSchema { return INTERACTION_SCHEMA; }

/** Closed structural admission for the reserved slot, including authored argument plans. @internal */
export function interaction_state_schema_internal(): HsonSchema { return INTERACTION_STATE_SCHEMA; }

/** Admit exact state and validate plan semantics that depend on other Descriptor fields. @internal */
export function validate_interaction_state_internal(
  root: HsonNode, isDocumentLibrary: (name: string) => boolean = () => true,
): readonly OrderedProjectedValue[] {
  validate_hson_schema_graph(INTERACTION_STATE_SCHEMA, root);
  const descriptors = interaction_descriptors_from_root(projected_value_from_hson_node(root));
  validate_interaction_subjects(ordered_projected_array(descriptors), isDocumentLibrary);
  for (const descriptor of descriptors) validate_descriptor_event_plan(descriptor);
  return descriptors;
}

/** Validate a complete retained commit boundary without resolving historical document paths. @internal */
export function validate_interaction_operation_endpoint_internal(
  path: readonly (string | number)[], value: OrderedProjectedValue | undefined, isDocumentLibrary: (name: string) => boolean,
): void {
  const field = path[0];
  if (path.length === 1 && field !== "descriptors") {
    if (value !== undefined && (typeof field !== "string" || !evaluate_canonical_projected_fields(
      compiled_hson_schema_of(INTERACTION_STATE_SCHEMA).graph, ordered_projected_object([[field, value]]),
    ).ok)) {
      throw new TypeError(`Canonical interaction root does not declare ${JSON.stringify(field)}.`);
    }
    return;
  }
  if (value === undefined) {
    if (path.length < 2) throw new TypeError("Canonical interaction state must retain its descriptors.");
    return;
  }
  if (path.length === 0) {
    validate_interaction_state_internal(projected_value_to_hson_root(value), isDocumentLibrary);
  } else if (path[0] === "descriptors" && path.length <= 2) {
    const descriptors = path.length === 1 ? value : ordered_projected_array([value]);
    const root = projected_value_to_hson_root(ordered_projected_object([["descriptors", descriptors]]));
    validate_interaction_state_internal(root, isDocumentLibrary);
  }
}

/** Select descriptor state by an already-authorized document set. @internal */
export function project_interaction_state_internal(root: HsonNode, includedDocuments: ReadonlySet<string>): HsonNode {
  const descriptors = validate_interaction_state_internal(root);
  const included = descriptors.filter((descriptor) => {
    if (!is_ordered_projected_object(descriptor)) throw new Error("Canonical interaction descriptor is malformed.");
    const subject = descriptor.entries.find(([key]) => key === "subject")?.[1];
    if (!is_ordered_projected_object(subject)) throw new Error("Canonical interaction subject is malformed.");
    const library = subject.entries.find(([key]) => key === "library")?.[1];
    if (typeof library !== "string") throw new Error("Canonical interaction subject is malformed.");
    return includedDocuments.has(library);
  });
  return projected_value_to_hson_root(ordered_projected_object([["descriptors", ordered_projected_array(included)]]));
}
