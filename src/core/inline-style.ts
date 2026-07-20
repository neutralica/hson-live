import type { CssMap, CssValue } from "./style.types.js";

type TypedCssValue = Readonly<{ value: string | number; unit?: string }>;

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A typed CSS value is one declaration leaf, never a nested rule map. */
export function is_typed_css_value(value: unknown): value is TypedCssValue {
  if (!is_plain_record(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "value" && key !== "unit")) return false;
  if (!("value" in value)) return false;
  if (typeof value.value !== "string"
    && !(typeof value.value === "number" && Number.isFinite(value.value))) return false;
  return value.unit === undefined || typeof value.unit === "string";
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
    const item = value[key];
    if (item === undefined || !is_css_declaration_value(item)) return undefined;
    if (is_typed_css_value(item)) {
      style[key] = Object.freeze(item.unit === undefined
        ? { value: item.value }
        : { value: item.value, unit: item.unit });
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
  if (!is_typed_css_value(value)) return undefined;
  const renderedValue = typeof value.value === "string" ? value.value.trim() : String(value.value);
  const unit = value.unit === "_" || value.unit === undefined ? "" : value.unit;
  return `${renderedValue}${unit}`.trim();
}
