import type { Position } from "../api/transform/token.types.js";
import { _throw_transform_err } from "../core/errors.js";
import { canonical_hson_data_from_node } from "../core/hson-data-canonical-codec.js";
import { ordered_projected_object, type OrderedProjectedObject, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { assemble_hson_tokens } from "../api/transform/parsers/assemble-hson-tokens.js";
import { reject_portable_quid_tokens } from "../api/transform/parsers/parse-hson-source.js";
import { tokenize_authored_event } from "../api/transform/parsers/tokenize-hson.js";
import type { InteractionListener } from "../types/interaction.descriptor.types.js";
import { DOCUMENT_CLICK_LISTENER } from "./listener-config.js";
import { PART_LOCAL_REFERENCE_MIGRATION, whole_part_reference, type PartReference } from "./part-placeholder.js";
import { interpolate_part_string, is_part_scalar_value, part_scalar_operand } from "./part-scalar.js";
import { decode_part_string_sigils } from "./part-scalar-source.js";
import type { Primitive } from "../core/types.js";

export type AuthoredEventReference = Readonly<{ reference: PartReference; start: Position; end: Position; root: Readonly<{ start: number; end: number }> }>;
type EventOperand =
  | Readonly<{ kind: "literal"; value: OrderedProjectedValue }>
  | Readonly<{ kind: "reference"; site: AuthoredEventReference }>
  | Readonly<{ kind: "interpolation"; text: string; sites: readonly AuthoredEventReference[] }>;
export type AuthoredEventArgument = Readonly<{
  name: string;
  qualifier: "str" | "num" | "data";
  header: Position;
  start: Position;
  end: Position;
  operand: EventOperand;
}>;
export type AuthoredEvent = Readonly<{
  kind: "locus" | "browser";
  key: string;
  actionStart: Position;
  listener: InteractionListener;
  args: readonly AuthoredEventArgument[];
}>;

/** Parse and normalize one declaration, leaving lexical references unresolved. */
export function parse_authored_event(source: string, operation = "Authored event declaration"): AuthoredEvent {
  if (typeof source !== "string") throw new TypeError(`${operation} requires Hson source text.`);
  const { start, flags, args } = tokenize_authored_event(source);
  let eventPosition: Position | undefined;
  let destination: Pick<AuthoredEvent, "kind" | "key" | "actionStart"> | undefined;
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
    } else {
      if (destination !== undefined) fail("Choose exactly one host: or local: action.", position, destination.actionStart);
      const key = flag.slice(flag.indexOf(":") + 1);
      if (key.length === 0) fail("Expected an action name after host: or local:.", position);
      destination = { kind: flag.startsWith("host:") ? "locus" : "browser", key, actionStart: position };
    }
  }
  if (eventPosition === undefined || destination === undefined) {
    return fail("An authored event requires on:click and one host: or local: action.", args[0]?.header ?? start);
  }
  return { ...destination, listener: { ...DOCUMENT_CLICK_LISTENER,
    once: flags.has("once"), stopPropagation: flags.has("stopProp") },
    args: args.map(arg => read_event_argument(arg, operation)) };
}

function read_event_argument(token: ReturnType<typeof tokenize_authored_event>["args"][number], operation: string): AuthoredEventArgument {
  const { operand, ...argument } = token;
  const { name, qualifier, start, end } = argument;
  const fail = (cause: unknown): never => _throw_transform_err(
    `Event argument ${JSON.stringify(`${name}:${qualifier}`)}. ${cause instanceof Error ? cause.message : String(cause)}`,
    operation, undefined, cause, {
      code: "HSON_EVENT_DECLARATION_INVALID", stage: "source-admission", source: event_source_position(start),
      related: [{ role: "value-end", source: event_source_position(end) }],
    });
  try {
    if (operand.kind === "data") {
      reject_portable_quid_tokens(operand.tokens);
      const root = assemble_hson_tokens(operand.tokens, attrs => {
        if (attrs.length !== 0) throw new TypeError("Hson Data cannot carry attributes or metadata.");
        return { attrs: {}, meta: {} };
      });
      return { ...argument, operand: { kind: "literal", value: canonical_hson_data_from_node(root) } };
    }
    if (operand.kind === "reference") {
      const { reference } = operand;
      // A bracket key in a bare reference may contain escaped characters, but
      // the authored reference itself retains its full source spelling.
      return { ...argument, operand: { kind: "reference", site: {
        reference, start, end, root: { start: start.index + 2, end: start.index + 2 + reference.name.length },
      } } };
    }

    const raw = operand.raw;
    const text: string = JSON.parse('"' + raw + '"');
    const literalSigils = decode_part_string_sigils(raw);
    const boundaries = quoted_value_boundaries(raw);
    const site = (reference: PartReference): AuthoredEventReference => {
      const position = (offset: number): Position => {
        const relative = 1 + boundaries[offset]!;
        return { index: start.index + relative, line: start.line, col: start.col + relative };
      };
      return { reference, start: position(reference.start), end: position(reference.end),
        root: { start: position(reference.start + 2).index, end: position(reference.start + 2 + reference.name.length).index } };
    };
    if (qualifier === "data") {
      if (text.startsWith("#{") && !literalSigils.has(0)) throw new TypeError(PART_LOCAL_REFERENCE_MIGRATION);
      const reference = literalSigils.has(0) ? undefined : whole_part_reference(text);
      if (reference === undefined) throw new TypeError("Expected {Hson Data} or one whole Part reference.");
      return { ...argument, operand: { kind: "reference", site: site(reference) } };
    }
    const scalar = part_scalar_operand(qualifier, text, literalSigils);
    if (scalar.kind === "literal") return { ...argument, operand: scalar };
    if (scalar.kind === "reference") return { ...argument, operand: { kind: "reference", site: site(scalar.reference) } };
    return { ...argument, operand: { kind: "interpolation", text, sites: scalar.references.map(site) } };
  } catch (cause) { return fail(cause); }
}

function quoted_value_boundaries(raw: string): readonly number[] {
  const boundaries = [0];
  for (let at = 0; at < raw.length;) {
    at += raw[at] === "\\" ? raw[at + 1] === "u" ? 6 : 2 : 1;
    boundaries.push(at);
  }
  return boundaries;
}

export function event_argument_references({ operand }: AuthoredEventArgument): readonly AuthoredEventReference[] {
  return operand.kind === "literal" ? [] : operand.kind === "reference" ? [operand.site] : operand.sites;
}

/** Construct one exact object, in declaration order. An absent optional operand omits its field. */
export function authored_event_args(args: readonly AuthoredEventArgument[],
  read: (site: AuthoredEventReference) => OrderedProjectedValue | undefined,
  invalid: (message: string, site: AuthoredEventReference) => never,
  bound: (length: number) => void): OrderedProjectedObject | undefined {
  if (args.length === 0) return undefined;
  const entries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const { name, qualifier, operand } of args) {
    let value: OrderedProjectedValue | undefined;
    if (operand.kind === "literal") value = operand.value;
    else if (operand.kind === "reference") {
      value = read(operand.site);
      if (value !== undefined && qualifier !== "data" && !is_part_scalar_value(qualifier, value)) {
        invalid(`Event argument ${JSON.stringify(name)} requires a ${qualifier} value.`, operand.site);
      }
    } else {
      let at = 0;
      value = interpolate_part_string(operand.text, operand.sites.map(site => site.reference), (): Primitive | undefined => {
        const site = operand.sites[at++]!;
        const value = read(site);
        if (value !== null && typeof value === "object") return invalid(`Event argument ${JSON.stringify(name)} interpolation requires a primitive value.`, site);
        return value;
      }, bound);
    }
    if (value !== undefined) entries.push([name, value]);
  }
  return ordered_projected_object(entries);
}

export function event_source_position(position: Position) {
  return { index: position.index, line: position.line, column: position.col };
}
