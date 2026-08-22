import type { CssMap, CssValue } from "./style.types.js";
import {
  has_inherited_property,
  own_enumerable_data_property,
} from "./node-storage.js";

type TypedCssValue = Readonly<{ value: string | number; unit?: string }>;
type InspectedTypedCssValue = Readonly<
  | { value: string | number; hasUnit: false }
  | { value: string | number; hasUnit: true; unit: string | undefined }
>;

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspect_typed_css_value(value: unknown): InspectedTypedCssValue | undefined {
  if (!is_plain_record(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "value" && key !== "unit")) return undefined;

  const inspectedValue = own_enumerable_data_property(value, "value");
  if (inspectedValue === undefined || !inspectedValue.present) return undefined;
  const semanticValue = inspectedValue.value;
  if (typeof semanticValue !== "string"
    && !(typeof semanticValue === "number" && Number.isFinite(semanticValue))) return undefined;

  const inspectedUnit = own_enumerable_data_property(value, "unit");
  if (inspectedUnit === undefined) return undefined;
  if (!inspectedUnit.present) {
    if (has_inherited_property(value, "unit")) return undefined;
    return { value: semanticValue, hasUnit: false };
  }
  if (inspectedUnit.value !== undefined && typeof inspectedUnit.value !== "string") return undefined;
  return { value: semanticValue, hasUnit: true, unit: inspectedUnit.value };
}

/** A typed CSS value is one declaration leaf, never a nested rule map. */
export function is_typed_css_value(value: unknown): value is TypedCssValue {
  return inspect_typed_css_value(value) !== undefined;
}

export function is_css_declaration_value(value: unknown): value is CssValue {
  return value === null || value === undefined || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
    || is_typed_css_value(value);
}

/** Validate and detach the flat canonical inline-style domain. */
export function canonical_inline_style(value: unknown): CssMap | undefined {
  if (!is_plain_record(value)) return undefined;
  const style: Record<string, CssValue> = {};
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return undefined;
    const item = descriptor.value;
    if (item === undefined || !is_css_declaration_value(item)) return undefined;
    const typed = inspect_typed_css_value(item);
    if (typed !== undefined) {
      style[key] = Object.freeze(typed.hasUnit
        ? { value: typed.value, unit: typed.unit }
        : { value: typed.value });
    } else {
      style[key] = item;
    }
  }
  return Object.freeze(style);
}

export function is_valid_inline_style(value: unknown): boolean {
  return canonical_inline_style(value) !== undefined;
}

/** Render one valid CSS declaration leaf; null means omit/remove, undefined means invalid. */
export function render_css_declaration_value(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  const typed = inspect_typed_css_value(value);
  if (typed === undefined) return undefined;
  const renderedValue = typeof typed.value === "string" ? typed.value.trim() : String(typed.value);
  const unit = !typed.hasUnit || typed.unit === "_" || typed.unit === undefined ? "" : typed.unit;
  return `${renderedValue}${unit}`.trim();
}
