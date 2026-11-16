import { is_valid_hson_data_name } from "../core/hson-name.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { hson_data_from_value, type HsonDataValue } from "../api/data/hson-data.js";
import { is_part_parameter_name } from "./part-placeholder.js";
import { is_part_scalar_value } from "./part-scalar.js";

export type EventArgumentQualifier = "str" | "num" | "data";
type OccurrenceEventFamily = "pointer" | "key";
type TargetEventFamily = "input" | "change";
export type NativeEventFamily = OccurrenceEventFamily | TargetEventFamily;
export type NativeEventValueKind = "number" | "string" | "boolean";

export const AUTHORED_EVENT_NAMES: ReadonlyMap<string, string> = new Map([
  ["on:click", "click"],
  ["on:pointer:down", "pointerdown"],
  ["on:pointer:move", "pointermove"],
  ["on:pointer:up", "pointerup"],
  ["on:pointer:cancel", "pointercancel"],
  ["on:key:down", "keydown"],
  ["on:key:up", "keyup"],
  ["on:input", "input"],
  ["on:change", "change"],
]);

const OCCURRENCE_PROPERTIES: Readonly<Record<OccurrenceEventFamily, ReadonlyMap<string, NativeEventValueKind>>> = {
  pointer: new Map([
    ["clientX", "number"], ["clientY", "number"], ["movementX", "number"], ["movementY", "number"],
    ["pointerId", "number"], ["pointerType", "string"], ["isPrimary", "boolean"], ["button", "number"], ["buttons", "number"],
    ["altKey", "boolean"], ["ctrlKey", "boolean"], ["metaKey", "boolean"], ["shiftKey", "boolean"],
  ]),
  key: new Map([
    ["key", "string"], ["code", "string"], ["location", "number"], ["repeat", "boolean"], ["isComposing", "boolean"],
    ["altKey", "boolean"], ["ctrlKey", "boolean"], ["metaKey", "boolean"], ["shiftKey", "boolean"],
  ]),
};

type NativeTargetInterface = "Element" | "HTMLInputElement" | "HTMLTextAreaElement" | "HTMLSelectElement"
  | "HTMLButtonElement" | "HTMLFieldSetElement" | "HTMLFormElement" | "HTMLObjectElement"
  | "HTMLOptionElement" | "HTMLOutputElement";
const TARGET_PROPERTIES: ReadonlyMap<string, Readonly<{
  kind: "string" | "boolean";
  interfaces: readonly NativeTargetInterface[];
}>> = new Map([
  ["tagName", { kind: "string", interfaces: ["Element"] }],
  ["id", { kind: "string", interfaces: ["Element"] }],
  ["name", { kind: "string", interfaces: ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "HTMLButtonElement", "HTMLFieldSetElement", "HTMLFormElement", "HTMLObjectElement", "HTMLOutputElement"] }],
  ["type", { kind: "string", interfaces: ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "HTMLButtonElement", "HTMLFieldSetElement", "HTMLObjectElement", "HTMLOutputElement"] }],
  ["value", { kind: "string", interfaces: ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "HTMLButtonElement", "HTMLOptionElement", "HTMLOutputElement"] }],
  ["checked", { kind: "boolean", interfaces: ["HTMLInputElement"] }],
]);

export function native_event_family(event: unknown): NativeEventFamily | undefined {
  switch (event) {
    case "pointerdown": case "pointermove": case "pointerup": case "pointercancel": return "pointer";
    case "keydown": case "keyup": return "key";
    case "input": case "change": return event;
    default: return undefined;
  }
}

export function native_event_class(family: NativeEventFamily): "PointerEvent" | "KeyboardEvent" | "Event" {
  return family === "pointer" ? "PointerEvent" : family === "key" ? "KeyboardEvent" : "Event";
}

function is_target_family(family: NativeEventFamily): family is TargetEventFamily {
  return family === "input" || family === "change";
}

export function native_event_paths(family: NativeEventFamily): ReadonlyMap<string, NativeEventValueKind> {
  return is_target_family(family)
    ? new Map([...TARGET_PROPERTIES].map(([property, { kind }]) => [`target.${property}`, kind]))
    : OCCURRENCE_PROPERTIES[family];
}

type NativeEventLookup =
  | readonly [family: OccurrenceEventFamily, property: string]
  | readonly [family: TargetEventFamily, relationship: "target", property: string];

export function read_native_event_lookup(family: NativeEventFamily, path: readonly unknown[]):
  Readonly<{ lookup: NativeEventLookup; valueKind: NativeEventValueKind }> | undefined {
  const [first, second] = path;
  if (is_target_family(family)) {
    if (path.length !== 2 || first !== "target" || typeof second !== "string") return undefined;
    const valueKind = TARGET_PROPERTIES.get(second)?.kind;
    return valueKind === undefined ? undefined : { lookup: [family, first, second], valueKind };
  }
  if (path.length !== 1 || typeof first !== "string") return undefined;
  const valueKind = OCCURRENCE_PROPERTIES[family].get(first);
  return valueKind === undefined ? undefined : { lookup: [family, first], valueKind };
}

export function native_event_scalar_qualifier(kind: NativeEventValueKind): "num" | "str" | undefined {
  return kind === "number" ? "num" : kind === "string" ? "str" : undefined;
}

export type DeferredEventArgument =
  | readonly [name: string, qualifier: EventArgumentQualifier]
  | readonly [name: string, qualifier: EventArgumentQualifier, capture: OrderedProjectedValue]
  | readonly [name: string, qualifier: EventArgumentQualifier, ...lookup: NativeEventLookup];

export function encode_event_argument_plan(plan: readonly DeferredEventArgument[]): OrderedProjectedValue {
  return ordered_projected_array(plan.map(field => ordered_projected_array(field)));
}

/** Validate the portable plan before publication or listener materialization. */
export function read_event_argument_plan(event: unknown, value: OrderedProjectedValue): readonly DeferredEventArgument[] {
  const family = native_event_family(event);
  if (family === undefined || !Array.isArray(value)) {
    throw new TypeError("A canonical event argument plan requires an array and a supported native Event listener.");
  }
  const names = new Set<string>();
  const fields: DeferredEventArgument[] = [];
  let deferred = false;
  for (const field of value) {
    if (!Array.isArray(field)) throw new TypeError("Invalid canonical event argument plan field.");
    const [name, qualifier, operand, ...path]: readonly OrderedProjectedValue[] = field;
    if (!is_valid_hson_data_name(name) || !is_part_parameter_name(name) || names.has(name)
      || qualifier !== "str" && qualifier !== "num" && qualifier !== "data") {
      throw new TypeError("Invalid or duplicate canonical event argument plan name or type.");
    }
    names.add(name);
    if (field.length === 2) fields.push([name, qualifier]);
    else if (field.length === 3 && (qualifier === "data" || is_part_scalar_value(qualifier, operand))) {
      fields.push([name, qualifier, operand]);
    } else {
      const native = operand === family ? read_native_event_lookup(family, path) : undefined;
      if (native === undefined || qualifier !== "data" && qualifier !== native_event_scalar_qualifier(native.valueKind)) {
        throw new TypeError(`Invalid canonical event argument plan operand for ${JSON.stringify(name)}.`);
      }
      fields.push([name, qualifier, ...native.lookup]);
      deferred = true;
    }
  }
  if (!deferred) throw new TypeError("A canonical event argument plan requires a deferred native lookup.");
  return fields;
}

export function validate_descriptor_event_plan(value: OrderedProjectedValue): void {
  if (!is_ordered_projected_object(value)) throw new TypeError("Canonical interaction descriptor is malformed.");
  const plan = value.entries.find(([name]) => name === "eventArgs")?.[1];
  if (plan === undefined) return;
  if (value.entries.some(([name]) => name === "args" || name === "payload")) {
    throw new TypeError("A canonical event argument plan cannot accompany resolved args or payload.");
  }
  const listener = value.entries.find(([name]) => name === "listener")?.[1];
  const event = is_ordered_projected_object(listener) ? listener.entries.find(([name]) => name === "event")?.[1] : undefined;
  read_event_argument_plan(event, plan);
}

/** Platform accessors check the native brand across realms and ignore lookalike own properties. */
export function extract_event_arguments(plan: readonly DeferredEventArgument[], event: Event): HsonDataValue {
  const family = plan.find(field => field.length === 4 || field.length === 5)?.[2];
  if (family === undefined) throw new TypeError("Event argument lookups require a deferred native lookup.");
  const prototype = is_target_family(family) ? undefined : require_occurrence_prototype(family, event);
  const entries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const field of plan) {
    if (field.length === 2) continue;
    if (field.length === 3) { entries.push([field[0], field[2]]); continue; }
    const value = field.length === 5 ? read_native_target_property(field[2], field[4], event)
      : read_native_occurrence_property(field[2], field[3], event, prototype);
    entries.push([field[0], value]);
  }
  return hson_data_from_value(ordered_projected_object(entries));
}

function platform_getter(prototype: object | undefined, property: string): (() => unknown) | undefined {
  return prototype === undefined ? undefined : Object.getOwnPropertyDescriptor(prototype, property)?.get;
}

function require_occurrence_prototype(family: OccurrenceEventFamily, event: Event): PointerEvent | KeyboardEvent {
  const prototype: PointerEvent | KeyboardEvent | undefined = family === "pointer"
    ? globalThis.PointerEvent?.prototype : globalThis.KeyboardEvent?.prototype;
  const brand = family === "pointer" ? "pointerType" : "key";
  const nativeClass = native_event_class(family);
  const brandError = `Event argument lookups require a native ${nativeClass}.`;
  const checkBrand = platform_getter(prototype, brand);
  if (prototype === undefined || checkBrand === undefined) throw new TypeError(brandError);
  try { Reflect.apply(checkBrand, event, []); }
  catch { throw new TypeError(brandError); }
  return prototype;
}

function read_native_occurrence_property(family: OccurrenceEventFamily, property: string, event: Event,
  prototype: PointerEvent | KeyboardEvent | undefined): string | number | boolean {
  const nativeClass = native_event_class(family);
  const kind = OCCURRENCE_PROPERTIES[family].get(property);
  if (kind === undefined) throw new TypeError(`Unsupported ${nativeClass} lookup ${family}.${property}.`);
  const getter = platform_getter(prototype, property)
    ?? (family === "pointer" ? platform_getter(globalThis.MouseEvent?.prototype, property) : undefined);
  const value: unknown = getter === undefined ? undefined : Reflect.apply(getter, event, []);
  if (!is_native_event_value(kind, value)) {
    throw new TypeError(`${nativeClass} lookup ${family}.${property} must produce ${kind === "number" ? "a finite number" : `a ${kind}`} from the native event.`);
  }
  return value;
}

function read_native_target_property(family: TargetEventFamily, property: string, event: Event): string | boolean {
  const lookup = `${family}.target.${property}`;
  const expected = TARGET_PROPERTIES.get(property);
  if (expected === undefined) throw new TypeError(`Unsupported Event lookup ${lookup}.`);
  const getter = platform_getter(globalThis.Event?.prototype, "target");
  let target: unknown;
  try { target = getter === undefined ? undefined : Reflect.apply(getter, event, []); }
  catch (cause) { throw new TypeError(`Event lookup ${lookup} requires a native Event.target.`, { cause }); }
  for (const name of expected.interfaces) {
    const read = platform_getter(globalThis[name]?.prototype, property);
    if (read === undefined) continue;
    let value: unknown;
    try { value = Reflect.apply(read, target, []); }
    catch { continue; /* This accessor rejected the target's native brand. */ }
    if (is_native_event_value(expected.kind, value) && typeof value !== "number") return value;
  }
  throw new TypeError(`Event lookup ${lookup} requires a native ${expected.interfaces.join(" or ")} target with a ${expected.kind} ${property} property.`);
}

function is_native_event_value(kind: NativeEventValueKind, value: unknown): value is string | number | boolean {
  return typeof value === kind && (typeof value !== "number" || Number.isFinite(value));
}
