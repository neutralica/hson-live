import { admit_data_input, hson_data_from_value, hson_data_value } from "../api/data/hson-data.js";
import { descriptor_to_value, interaction_descriptor } from "../api/interactions/interactions.descriptor.js";
import { is_ordered_projected_object, type OrderedProjectedObject } from "../core/ordered-projected-value.js";
import { is_part_parameter_name } from "./part-placeholder.js";
import { authored_event_args, fail_event_reference, parse_authored_event, standalone_event_reference_issue } from "./authored-events.js";
import { encode_event_argument_plan } from "./event-argument-plan.js";
import type { InteractionSubject } from "../types/interaction.descriptor.types.js";

/** Standalone declarations share the Part parser but have no Part lexical scope. */
export function authored_interaction_descriptor(source: string, subject: InteractionSubject, id: string) {
  const operation = "Document listen.event";
  const event = parse_authored_event(source, operation);
  const { data, eventArgs } = authored_event_args(event.args,
    site => fail_event_reference(standalone_event_reference_issue(site), site, operation),
    (message, site) => fail_event_reference(message, site, operation), () => {});
  const listener = subject.kind === "document" && event.listener.target === "element"
    ? { ...event.listener, target: "document" as const } : event.listener;
  return interaction_descriptor(id, subject, listener, event.kind, event.key,
    data === undefined ? undefined : hson_data_from_value(data),
    eventArgs === undefined ? undefined : hson_data_from_value(encode_event_argument_plan(eventArgs)));
}

/** Construction input is lowered once into the sole canonical interaction root. */
export function document_event_contributions(library: string, input: unknown): readonly OrderedProjectedObject[] {
  const value = hson_data_value(admit_data_input(input));
  if (!is_ordered_projected_object(value)) throw new TypeError("Document events requires a record of authored declaration strings.");
  return Object.freeze(value.entries.map(([name, source]) => {
    if (!is_part_parameter_name(name) || typeof source !== "string") {
      throw new TypeError("Document events requires identifier keys and authored declaration strings.");
    }
    return descriptor_to_value(authored_interaction_descriptor(source, { library, kind: "document" }, `document-event/${library}/${name}`));
  }));
}
