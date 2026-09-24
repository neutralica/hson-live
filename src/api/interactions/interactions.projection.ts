import { Hson } from "../../hson-authoring.js";
import type { HsonNode } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { projected_value_from_hson_node, projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object } from "../../core/ordered-projected-value.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";

const INTERACTION_SCHEMA: HsonSchema = Hson.schema`<type "data" content <descriptors <array <union [
  <content <id "string" subject <content <library "string" path <array <number <int true min 0>>>>> listener <content <event "string" target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]> capture "boolean" once "boolean" passive "boolean" missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]> preventDefault "boolean" stopPropagation "boolean" stopImmediatePropagation "boolean">> kind <exact "browser-local"> key "string" args "any">>,
  <content <id "string" subject <content <library "string" path <array <number <int true min 0>>>>> listener <content <event "string" target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]> capture "boolean" once "boolean" passive "boolean" missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]> preventDefault "boolean" stopPropagation "boolean" stopImmediatePropagation "boolean">> kind <exact "locus-authoritative"> key "string" payload "any">>
]>>>>`;

/** Fixed framework Schema for the system slot; not an application contract. @internal */
export function interaction_schema_internal(): HsonSchema { return INTERACTION_SCHEMA; }

/** Select descriptor state by an already-authorized document set. @internal */
export function project_interaction_state_internal(root: HsonNode, includedDocuments: ReadonlySet<string>): HsonNode {
  validate_hson_schema_graph(INTERACTION_SCHEMA, root);
  const state = projected_value_from_hson_node(root);
  if (!is_ordered_projected_object(state)) throw new Error("Canonical interaction state is malformed.");
  const descriptors = state.entries.find(([key]) => key === "descriptors")?.[1];
  if (!Array.isArray(descriptors)) throw new Error("Canonical interaction state is malformed.");
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
