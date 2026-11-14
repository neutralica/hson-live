import { is_valid_hson_data_name } from "../core/hson-name.js";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../core/ordered-projected-value.js";
import { hson_data_from_value, type HsonDataValue } from "../api/data/hson-data.js";
import { is_part_parameter_name } from "./part-placeholder.js";
import { is_part_scalar_value } from "./part-scalar.js";

export const POINTER_EVENT_PROPERTIES = Object.freeze(["clientX", "clientY", "movementX", "movementY"] as const);
export type PointerEventProperty = typeof POINTER_EVENT_PROPERTIES[number];
export type EventArgumentQualifier = "str" | "num" | "data";

export type DeferredEventArgument =
  | readonly [name: string, qualifier: EventArgumentQualifier]
  | readonly [name: string, qualifier: EventArgumentQualifier, capture: OrderedProjectedValue]
  | readonly [name: string, qualifier: "num" | "data", source: "pointer", property: PointerEventProperty];

export function is_pointer_event_name(event: unknown): event is "pointerdown" | "pointermove" {
  return event === "pointerdown" || event === "pointermove";
}

export function is_pointer_event_property(value: unknown): value is PointerEventProperty {
  return POINTER_EVENT_PROPERTIES.some(property => property === value);
}

export function encode_event_argument_plan(plan: readonly DeferredEventArgument[]): OrderedProjectedValue {
  return ordered_projected_array(plan.map(field => ordered_projected_array(field)));
}

/** Validate the portable plan before publication or listener materialization. */
export function read_event_argument_plan(event: unknown, value: OrderedProjectedValue): readonly DeferredEventArgument[] {
  if (!is_pointer_event_name(event) || !Array.isArray(value)) {
    throw new TypeError("A canonical event argument plan requires an array and a pointerdown or pointermove listener.");
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
    } else if (field.length === 4 && (qualifier === "num" || qualifier === "data") && operand === "pointer"
      && is_pointer_event_property(property)) {
      fields.push([name, qualifier, "pointer", property]);
      deferred = true;
    } else throw new TypeError(`Invalid canonical event argument plan operand for ${JSON.stringify(name)}.`);
  }
  if (!deferred) throw new TypeError("A canonical event argument plan requires a deferred pointer lookup.");
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

/** A retained operation can carry complete descriptors even when its checkpoint already covers it. */
export function validate_interaction_operation_plans(path: readonly (string | number)[],
  value: OrderedProjectedValue | undefined): void {
  if (path.length === 0 && is_ordered_projected_object(value)) {
    value = value.entries.find(([name]) => name === "descriptors")?.[1];
  }
  if (path.length === 0 || path[0] === "descriptors" && path.length === 1) {
    if (Array.isArray(value)) for (const entry of value) validate_descriptor_event_plan(entry);
  } else if (path[0] === "descriptors" && path.length === 2 && value !== undefined) {
    validate_descriptor_event_plan(value);
  }
}

/** Use platform accessors so cross-realm PointerEvents work and plain Events with lookalike fields fail. */
export function extract_event_arguments(plan: readonly DeferredEventArgument[], event: Event): HsonDataValue {
  const pointerType = typeof PointerEvent === "undefined" ? undefined : Object.getOwnPropertyDescriptor(PointerEvent.prototype, "pointerType")?.get;
  if (pointerType === undefined) throw new TypeError("Event argument lookups require a native PointerEvent.");
  try { Reflect.apply(pointerType, event, []); }
  catch { throw new TypeError("Event argument lookups require a native PointerEvent."); }

  const entries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const field of plan) {
    if (field.length === 2) continue;
    const [name, , capture, property] = field;
    if (property === undefined) { entries.push([name, capture]); continue; }
    const getter = Object.getOwnPropertyDescriptor(MouseEvent.prototype, property)?.get;
    const value: unknown = getter === undefined ? undefined : Reflect.apply(getter, event, []);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`PointerEvent lookup pointer.${property} must produce a finite number.`);
    }
    entries.push([name, value]);
  }
  return hson_data_from_value(ordered_projected_object(entries));
}
