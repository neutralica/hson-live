import type { Position } from "../api/transform/token.types.js";
import { _throw_transform_err } from "../core/errors.js";
import { canonical_hson_data_from_node } from "../core/hson-data-canonical-codec.js";
import type { OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { assemble_hson_tokens } from "../api/transform/parsers/assemble-hson-tokens.js";
import { reject_portable_quid_tokens } from "../api/transform/parsers/parse-hson-source.js";
import { tokenize_authored_event } from "../api/transform/parsers/tokenize-hson.js";
import type { InteractionListener } from "../types/interaction.descriptor.types.js";
import { DOCUMENT_CLICK_LISTENER } from "./listener-config.js";
import type { PartReference } from "./part-placeholder.js";

export type AuthoredEventReferenceInput = Readonly<{ kind: "reference"; reference: PartReference; start: Position; end: Position }>;
type EventInput = Readonly<{ kind: "literal"; value: OrderedProjectedValue }> | AuthoredEventReferenceInput;
export type AuthoredEvent = Readonly<{ kind: "locus" | "browser"; key: string; listener: InteractionListener; input: EventInput | undefined }>;

/** Parse and normalize one declaration, leaving lexical references unresolved. */
export function parse_authored_event(source: string, operation = "Authored event declaration"): AuthoredEvent {
  if (typeof source !== "string") throw new TypeError(`${operation} requires Hson source text.`);
  const { start, flags, input } = tokenize_authored_event(source);
  let eventPosition: Position | undefined;
  let destination: (Pick<AuthoredEvent, "kind" | "key"> & { position: Position }) | undefined;
  const fail = (message: string, position: Position, first?: Position): never =>
    _throw_transform_err(message, operation, undefined, undefined, {
      code: "HSON_EVENT_DECLARATION_INVALID", stage: "source-admission", source: event_source_position(position),
      ...(first === undefined ? {} : { related: [{ role: "first-declaration", source: event_source_position(first) }] }),
    });
  for (const [flag, position] of flags) {
    if (flag === "once" || flag === "stopProp") continue;
    if (flag.startsWith("on:")) {
      if (eventPosition !== undefined) fail("An authored event requires exactly one on: selector.", position, eventPosition);
      eventPosition = position;
      if (flag !== "on:click") fail("This authored event slice supports only on:click.", position);
    } else if (flag.startsWith("host:") || flag.startsWith("local:")) {
      if (destination !== undefined) fail("Choose exactly one host: or local: action.", position, destination.position);
      const key = flag.slice(flag.indexOf(":") + 1);
      if (key.length === 0) fail("Expected an action name after host: or local:.", position);
      destination = { kind: flag.startsWith("host:") ? "locus" : "browser", key, position };
    } else fail(`Unsupported authored event header item ${JSON.stringify(flag)}.`, position);
  }
  if (eventPosition === undefined || destination === undefined) {
    return fail("An authored event requires on:click and one host: or local: action.", input?.start ?? start);
  }
  return { kind: destination.kind, key: destination.key, listener: { ...DOCUMENT_CLICK_LISTENER,
    once: flags.has("once"), stopPropagation: flags.has("stopProp") }, input: read_event_input(input) };
}

function read_event_input(input: ReturnType<typeof tokenize_authored_event>["input"]): EventInput | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input.value)) return { kind: "reference", reference: input.value, start: input.start, end: input.end };
  reject_portable_quid_tokens(input.value);
  const root = assemble_hson_tokens(input.value, attrs => {
    if (attrs.length !== 0) throw new TypeError("input:data cannot carry attributes or metadata.");
    return { attrs: {}, meta: {} };
  });
  return { kind: "literal", value: canonical_hson_data_from_node(root) };
}

export function event_source_position(position: Position) {
  return { index: position.index, line: position.line, column: position.col };
}
