import { event_attachment_position } from "../core/authored-event-names.js";
import type { Position } from "../api/transform/token.types.js";
import { _throw_transform_err } from "../core/errors.js";
import { canonical_hson_data_from_node } from "../core/hson-data-canonical-codec.js";
import { is_ordinary_element_node } from "../core/node-guards.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import type { HsonNode } from "../core/types.js";
import { assemble_hson_tokens } from "../api/transform/parsers/assemble-hson-tokens.js";
import { reject_portable_quid_tokens } from "../api/transform/parsers/parse-hson-source.js";
import { tokenize_authored_event } from "../api/transform/parsers/tokenize-hson.js";
import type { InteractionListener } from "../types/interaction.descriptor.types.js";
import { is_part_parameter_name, type PartReference } from "./part-placeholder.js";

export type PartEventReferenceInput = Readonly<{ kind: "reference"; reference: PartReference; start: Position; end: Position }>;
type EventInput = Readonly<{ kind: "literal"; value: OrderedProjectedValue }> | PartEventReferenceInput;
export type PartEvent = Readonly<{ kind: "locus" | "browser"; key: string; listener: InteractionListener; input: EventInput }>;
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
  const { flags, input } = tokenize_authored_event(source);
  let event: string | undefined, eventPosition: Position | undefined;
  let destination: (Pick<PartEvent, "kind" | "key"> & { position: Position }) | undefined;
  const fail = (message: string, position: Position, first?: Position): never =>
    _throw_transform_err(message, "Part event declaration", undefined, undefined, {
      code: "HSON_EVENT_DECLARATION_INVALID", stage: "source-admission", source: source_position(position),
      ...(first === undefined ? {} : { related: [{ role: "first-declaration", source: source_position(first) }] }),
    });
  for (const [flag, position] of flags) {
    if (flag === "once" || flag === "stopProp") continue;
    if (flag.startsWith("on:")) {
      if (eventPosition !== undefined) fail("An authored event requires exactly one on: selector.", position, eventPosition);
      event = flag.slice(3);
      eventPosition = position;
      if (event !== "click") fail("This authored event slice supports only on:click.", position);
    } else if (flag.startsWith("host:") || flag.startsWith("local:")) {
      if (destination !== undefined) fail("Choose exactly one host: or local: behavior.", position, destination.position);
      const key = flag.slice(flag.indexOf(":") + 1);
      if (key.length === 0) fail("Expected a behavior name after host: or local:.", position);
      destination = { kind: flag.startsWith("host:") ? "locus" : "browser", key, position };
    } else fail(`Unsupported authored event header item ${JSON.stringify(flag)}.`, position);
  }
  if (event === undefined || destination === undefined) return fail("An authored event requires on:click and one host: or local: behavior.", input.start);
  let argument: EventInput;
  if (Array.isArray(input.value)) {
    reject_portable_quid_tokens(input.value);
    const root = assemble_hson_tokens(input.value, attrs => {
      if (attrs.length !== 0) throw new TypeError("input:data cannot carry attributes or metadata.");
      return { attrs: {}, meta: {} };
    });
    argument = { kind: "literal", value: canonical_hson_data_from_node(root) };
  } else argument = { kind: "reference", reference: input.value, start: input.start, end: input.end };
  return { kind: destination.kind, key: destination.key, listener: { event, target: "element", capture: false, once: flags.has("once"),
    passive: false, missingTarget: "ignore", preventDefault: false, stopPropagation: flags.has("stopProp"),
    stopImmediatePropagation: false }, input: argument };
}

function source_position(position: Position) {
  return { index: position.index, line: position.line, column: position.col };
}

export function fail_part_event_reference(message: string, input: PartEventReferenceInput, node: HsonNode, attribute: string, cause?: unknown): never {
  const attachment = event_attachment_position(node, attribute);
  return _throw_transform_err(message, "Part event input", undefined, cause, {
    code: "HSON_EVENT_REFERENCE_INVALID", stage: "source-admission", source: source_position(input.start),
    related: [{ role: "value-end", source: source_position(input.end) },
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
