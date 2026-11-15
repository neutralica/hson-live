import type { Position } from "../api/transform/token.types.js";
import { AUTHORED_EVENT_FLAGS } from "../core/authored-event-names.js";
import { _throw_transform_err } from "../core/errors.js";
import { canonical_hson_data_from_node } from "../core/hson-data-canonical-codec.js";
import { ordered_projected_object, type OrderedProjectedObject, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { assemble_hson_tokens } from "../api/transform/parsers/assemble-hson-tokens.js";
import { reject_portable_quid_tokens } from "../api/transform/parsers/parse-hson-source.js";
import { tokenize_authored_event } from "../api/transform/parsers/tokenize-hson.js";
import type { InteractionListener } from "../types/interaction.descriptor.types.js";
import { DOCUMENT_CLICK_LISTENER } from "./listener-config.js";
import { PART_LOCAL_REFERENCE_MIGRATION, part_reference_text, whole_part_reference, type PartReference } from "./part-placeholder.js";
import { interpolate_part_string, is_part_scalar_value, part_scalar_operand } from "./part-scalar.js";
import { decode_part_string_sigils } from "./part-scalar-source.js";
import type { Primitive } from "../core/types.js";
import { AUTHORED_EVENT_NAMES, NATIVE_EVENT_PROPERTIES, native_event_family, native_event_scalar_qualifier,
  type DeferredEventArgument, type EventArgumentQualifier, type NativeEventFamily, type NativeEventValueKind } from "./event-argument-plan.js";

const AUTHORED_EVENT_SELECTORS = [...AUTHORED_EVENT_NAMES.keys()].join(", ");

export type AuthoredEventReference = Readonly<{ reference: PartReference; start: Position; end: Position; root: Readonly<{ start: number; end: number }> }>;
type EventOperand =
  | Readonly<{ kind: "literal"; value: OrderedProjectedValue }>
  | Readonly<{ kind: "reference"; site: AuthoredEventReference }>
  | Readonly<{ kind: "native"; site: AuthoredEventReference; family: NativeEventFamily; property: string; valueKind: NativeEventValueKind }>
  | Readonly<{ kind: "interpolation"; text: string; sites: readonly AuthoredEventReference[] }>;
export type AuthoredEventArgument = Readonly<{
  name: string;
  qualifier: EventArgumentQualifier;
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

/** Parse one declaration and bind native lookups, leaving Part references unresolved. */
export function parse_authored_event(source: string, operation = "Authored event declaration"): AuthoredEvent {
  if (typeof source !== "string") throw new TypeError(`${operation} requires Hson source text.`);
  const { start, flags, args } = tokenize_authored_event(source);
  let eventPosition: Position | undefined;
  let event: string | undefined;
  let destination: Pick<AuthoredEvent, "kind" | "key" | "actionStart"> | undefined;
  let placement: Position | undefined;
  const fail = (message: string, position: Position, first?: Position): never =>
    _throw_transform_err(message, operation, undefined, undefined, {
      code: "HSON_EVENT_DECLARATION_INVALID", stage: "source-admission", source: event_source_position(position),
      ...(first === undefined ? {} : { related: [{ role: "first-declaration", source: event_source_position(first) }] }),
    });
  for (const [flag, position] of flags) {
    if (flag === "document" || flag === "window") {
      if (placement !== undefined) fail("Ambiguous listener target: document and window are mutually exclusive.", position, placement);
      placement = position;
    }
    if (AUTHORED_EVENT_FLAGS.has(flag)) continue;
    if (flag.startsWith("on:")) {
      if (eventPosition !== undefined) fail("An authored event requires exactly one on: selector.", position, eventPosition);
      eventPosition = position;
      event = AUTHORED_EVENT_NAMES.get(flag);
      if (event === undefined) fail(`Unsupported Event selector ${JSON.stringify(flag)}. Use ${AUTHORED_EVENT_SELECTORS}.`, position);
    } else {
      if (destination !== undefined) fail("Choose exactly one host: or local: action.", position, destination.actionStart);
      const key = flag.slice(flag.indexOf(":") + 1);
      if (key.length === 0) fail("Expected an action name after host: or local:.", position);
      destination = { kind: flag.startsWith("host:") ? "locus" : "browser", key, actionStart: position };
    }
  }
  if (event === undefined || destination === undefined) {
    return fail(`An authored event requires one of ${AUTHORED_EVENT_SELECTORS} and one host: or local: action.`, args[0]?.header ?? start);
  }
  return { ...destination, listener: { ...DOCUMENT_CLICK_LISTENER, event,
    target: flags.has("document") ? "document" : flags.has("window") ? "window" : "element",
    once: flags.has("once"), capture: flags.has("capture"), passive: flags.has("passive"),
    preventDefault: flags.has("preventDefault"), stopPropagation: flags.has("stopProp"),
    stopImmediatePropagation: flags.has("stopImmediateProp") },
    args: args.map(arg => bind_event_argument(event, read_event_argument(arg, operation), operation)) };
}

export function missing_native_event_binding(reference: PartReference): string | undefined {
  const { name } = reference;
  if (reference.namespace !== "local" || name !== "pointer" && name !== "key") return undefined;
  const selectors = [...AUTHORED_EVENT_NAMES].filter(([, event]) => native_event_family(event) === name).map(([selector]) => selector);
  return `The native ${name} binding requires ${selectors.join(" or ")}.`;
}

function bind_event_argument(event: string, argument: AuthoredEventArgument, operation: string): AuthoredEventArgument {
  const family = native_event_family(event);
  if (family === undefined) return argument;
  const site = event_argument_references(argument).find(({ reference }) => reference.namespace === "local" && reference.name === family);
  if (site === undefined) return argument;
  const [property] = site.reference.path;
  const properties = NATIVE_EVENT_PROPERTIES[family];
  const valueKind = site.reference.path.length === 1 && typeof property === "string" ? properties.get(property) : undefined;
  if (valueKind === undefined || typeof property !== "string") {
    return fail_event_reference(`Unsupported ${family} Event lookup ${part_reference_text(site.reference)}. Use ${[...properties.keys()].map(name => `${family}.${name}`).join(", ")}.`, site, operation);
  }
  const scalar = native_event_scalar_qualifier(valueKind);
  if (argument.operand.kind !== "reference" || argument.qualifier !== "data" && argument.qualifier !== scalar) {
    return fail_event_reference(`A ${family} Event lookup supplies a ${valueKind} and requires a whole ${scalar === undefined ? "" : `:${scalar} or `}:data argument.`, site, operation);
  }
  return { ...argument, operand: { kind: "native", site, family, property, valueKind } };
}

export function standalone_event_reference_issue(site: AuthoredEventReference): string {
  return missing_native_event_binding(site.reference)
    ?? "Standalone event arguments cannot resolve Part references. Supply literals or a lookup from the selected native Event.";
}

export function fail_event_reference(message: string, site: AuthoredEventReference, operation: string): never {
  return _throw_transform_err(message, operation, undefined, undefined, {
    code: "HSON_EVENT_REFERENCE_INVALID", stage: "source-admission", source: event_source_position(site.start),
    related: [{ role: "value-end", source: event_source_position(site.end) }],
  });
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
  return operand.kind === "literal" ? [] : operand.kind === "interpolation" ? operand.sites : [operand.site];
}

export type AuthoredEventArguments = Readonly<{ data: OrderedProjectedObject | undefined; eventArgs?: readonly DeferredEventArgument[] }>;

/** Capture the arguments in declaration order. Only a native lookup needs dispatch work. */
export function authored_event_args(args: readonly AuthoredEventArgument[],
  read: (site: AuthoredEventReference) => OrderedProjectedValue | undefined,
  invalid: (message: string, site: AuthoredEventReference) => never,
  bound: (length: number) => void): AuthoredEventArguments {
  if (args.length === 0) return { data: undefined };
  const fields: DeferredEventArgument[] = [];
  let deferred = false;
  for (const { name, qualifier, operand } of args) {
    if (operand.kind === "native") {
      fields.push([name, qualifier, operand.family, operand.property]);
      deferred = true;
      continue;
    }
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
    fields.push(value === undefined ? [name, qualifier] : [name, qualifier, value]);
  }
  return deferred ? { data: undefined, eventArgs: fields }
    : { data: ordered_projected_object(fields.flatMap(field => field.length === 3 ? [[field[0], field[2]] as const] : [])) };
}

export function event_source_position(position: Position) {
  return { index: position.index, line: position.line, column: position.col };
}
