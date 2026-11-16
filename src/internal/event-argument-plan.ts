import { is_valid_hson_data_name } from "../core/hson-name.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { hson_data_from_value, type HsonDataValue } from "../api/data/hson-data.js";
import { is_part_parameter_name } from "./part-placeholder.js";
import { is_part_scalar_value } from "./part-scalar.js";

export type EventArgumentQualifier = "str" | "num" | "data";
export type NativeEventFamily = "pointer" | "key";
export type NativeEventValueKind = "number" | "string" | "boolean";

export const AUTHORED_EVENT_NAMES: ReadonlyMap<string, string> = new Map([
  ["on:click", "click"],
  ["on:pointer:down", "pointerdown"],
  ["on:pointer:move", "pointermove"],
  ["on:pointer:up", "pointerup"],
  ["on:pointer:cancel", "pointercancel"],
  ["on:key:down", "keydown"],
  ["on:key:up", "keyup"],
]);

export const NATIVE_EVENT_PROPERTIES: Readonly<Record<NativeEventFamily, ReadonlyMap<string, NativeEventValueKind>>> = {
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

export function native_event_family(event: unknown): NativeEventFamily | undefined {
  switch (event) {
    case "pointerdown": case "pointermove": case "pointerup": case "pointercancel": return "pointer";
    case "keydown": case "keyup": return "key";
    default: return undefined;
  }
}

export function native_event_class(family: NativeEventFamily): "PointerEvent" | "KeyboardEvent" {
  return family === "pointer" ? "PointerEvent" : "KeyboardEvent";
}

export function native_event_scalar_qualifier(kind: NativeEventValueKind): "num" | "str" | undefined {
  return kind === "number" ? "num" : kind === "string" ? "str" : undefined;
}

export type DeferredEventArgument =
  | readonly [name: string, qualifier: EventArgumentQualifier]
  | readonly [name: string, qualifier: EventArgumentQualifier, capture: OrderedProjectedValue]
  | readonly [name: string, qualifier: EventArgumentQualifier, source: NativeEventFamily, property: string];

export function encode_event_argument_plan(plan: readonly DeferredEventArgument[]): OrderedProjectedValue {
  return ordered_projected_array(plan.map(field => ordered_projected_array(field)));
}

/** Validate the portable plan before publication or listener materialization. */
export function read_event_argument_plan(event: unknown, value: OrderedProjectedValue): readonly DeferredEventArgument[] {
  const family = native_event_family(event);
  if (family === undefined || !Array.isArray(value)) {
    throw new TypeError("A canonical event argument plan requires an array and a supported pointer or keyboard listener.");
  }
  const names = new Set<string>();
  const fields: DeferredEventArgument[] = [];
  let deferred = false;
  for (const field of value) {
    if (!Array.isArray(field)) throw new TypeError("Invalid canonical event argument plan field.");
    const [name, qualifier, operand, property]: readonly OrderedProjectedValue[] = field;
    if (!is_valid_hson_data_name(name) || !is_part_parameter_name(name) || names.has(name)
      || qualifier !== "str" && qualifier !== "num" && qualifier !== "data") {
      throw new TypeError("Invalid or duplicate canonical event argument plan name or type.");
    }
    names.add(name);
    if (field.length === 2) fields.push([name, qualifier]);
    else if (field.length === 3 && (qualifier === "data" || is_part_scalar_value(qualifier, operand))) {
      fields.push([name, qualifier, operand]);
    } else if (field.length === 4 && operand === family && typeof property === "string") {
      const kind = NATIVE_EVENT_PROPERTIES[family].get(property);
      if (kind === undefined || qualifier !== "data" && qualifier !== native_event_scalar_qualifier(kind)) {
        throw new TypeError(`Invalid canonical event argument plan operand for ${JSON.stringify(name)}.`);
      }
      fields.push([name, qualifier, family, property]);
      deferred = true;
    } else throw new TypeError(`Invalid canonical event argument plan operand for ${JSON.stringify(name)}.`);
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
  const family = plan.find(field => field.length === 4)?.[2];
  if (family === undefined) throw new TypeError("Event argument lookups require a deferred native lookup.");
  const prototype: PointerEvent | KeyboardEvent | undefined = family === "pointer"
    ? globalThis.PointerEvent?.prototype : globalThis.KeyboardEvent?.prototype;
  const brand = family === "pointer" ? "pointerType" : "key";
  const nativeClass = native_event_class(family);
  const brandError = `Event argument lookups require a native ${nativeClass}.`;
  const checkBrand = prototype === undefined ? undefined : Object.getOwnPropertyDescriptor(prototype, brand)?.get;
  if (prototype === undefined || checkBrand === undefined) throw new TypeError(brandError);
  try { Reflect.apply(checkBrand, event, []); }
  catch { throw new TypeError(brandError); }

  const entries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const field of plan) {
    if (field.length === 2) continue;
    if (field.length === 3) { entries.push([field[0], field[2]]); continue; }
    const [name, , source, property] = field;
    const kind = NATIVE_EVENT_PROPERTIES[family].get(property);
    if (source !== family || kind === undefined) throw new TypeError(`Unsupported ${nativeClass} lookup ${source}.${property}.`);
    const getter = Object.getOwnPropertyDescriptor(prototype, property)?.get
      ?? (family === "pointer" && globalThis.MouseEvent !== undefined
        ? Object.getOwnPropertyDescriptor(MouseEvent.prototype, property)?.get : undefined);
    const value: unknown = getter === undefined ? undefined : Reflect.apply(getter, event, []);
    if (!is_native_event_value(kind, value)) {
      throw new TypeError(`${nativeClass} lookup ${family}.${property} must produce ${kind === "number" ? "a finite number" : `a ${kind}`} from the native event.`);
    }
    entries.push([name, value]);
  }
  return hson_data_from_value(ordered_projected_object(entries));
}

function is_native_event_value(kind: NativeEventValueKind, value: unknown): value is string | number | boolean {
  return typeof value === kind && (typeof value !== "number" || Number.isFinite(value));
}
