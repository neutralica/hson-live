import { event_attachment_position } from "../core/authored-event-names.js";
import { _throw_transform_err } from "../core/errors.js";
import { is_ordinary_element_node } from "../core/node-guards.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import type { HsonNode } from "../core/types.js";
import { event_source_position, parse_authored_event, type AuthoredEvent, type AuthoredEventReferenceInput } from "./authored-events.js";
import { is_part_parameter_name } from "./part-placeholder.js";

export type PartEventReferenceInput = AuthoredEventReferenceInput;
export type PartEvent = AuthoredEvent;
export type PartEvents = ReadonlyMap<string, PartEvent>;

export function read_part_events(value: OrderedProjectedValue): PartEvents {
  if (!is_ordered_projected_object(value)) throw new TypeError("Part events requires a record of authored declaration strings.");
  const events = new Map<string, PartEvent>();
  for (const [name, source] of value.entries) {
    if (!is_part_parameter_name(name) || typeof source !== "string") {
      throw new TypeError("Part events requires identifier keys and authored declaration strings.");
    }
    try { events.set(name, parse_part_event(source)); }
    catch (cause) {
      throw new TypeError(`Invalid Part event ${JSON.stringify(name)}. ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
  return events;
}

export function parse_part_event(source: string): PartEvent {
  return parse_authored_event(source, "Part event declaration");
}

export function fail_part_event_reference(message: string, input: PartEventReferenceInput, node: HsonNode, attribute: string, cause?: unknown): never {
  const attachment = event_attachment_position(node, attribute);
  return _throw_transform_err(message, "Part event input", undefined, cause, {
    code: "HSON_EVENT_REFERENCE_INVALID", stage: "source-admission", source: event_source_position(input.start),
    related: [{ role: "value-end", source: event_source_position(input.end) },
      ...(attachment === undefined ? [] : [{ role: "event-attachment", source: attachment }])],
  });
}

/** Resolve a header marker only against the currently selected authored definition. */
export function part_event_attachment<T>(node: HsonNode, attribute: string, events: Pick<ReadonlyMap<string, T>, "get"> | undefined): T {
  const fail = (message: string): never => _throw_transform_err(message, "Part event attachment", undefined, undefined, {
    code: "HSON_EVENT_ATTACHMENT_INVALID", stage: "source-admission", source: event_attachment_position(node, attribute),
  });
  const key = attribute.slice("event:".length);
  if (!attribute.startsWith("event:") || !is_part_parameter_name(key)
    || !is_ordinary_element_node(node) || node.$_tag.toLowerCase() === "hson-part") {
    return fail("An authored event attachment requires an event:name flag on an ordinary Part element.");
  }
  if (events === undefined) return fail("An event:name attachment requires a governed Part's events collection.");
  const event = events.get(key);
  if (event === undefined) return fail(`Missing Part event declaration ${JSON.stringify(key)}.`);
  return event;
}
