import { _META_DATA_PREFIX } from "../../core/constants.js";
import type { Primitive } from "../../core/types.js";
import type { CssMap } from "../../core/style.types.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
} from "../../types/livemap.types.js";

const HSON_ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

export function is_public_document_attr_name(value: unknown): value is string {
  return typeof value === "string"
    && HSON_ATTR_NAME.test(value)
    && !value.startsWith(_META_DATA_PREFIX);
}

export function decode_document_attr_value(
  name: string,
  value: unknown,
): LiveMapDocumentAttributeValue | undefined {
  if (is_finite_primitive(value)) return value;
  return name === "style" ? canonical_style_map(value, new WeakSet<object>()) : undefined;
}

/** Validate, detach, freeze, and deterministically order a complete attrs bag. */
export function decode_document_attrs(value: unknown): LiveMapDocumentAttrs | undefined {
  if (!is_plain_record(value)) return undefined;
  const attrs: Record<string, LiveMapDocumentAttributeValue> = {};
  for (const name of Object.keys(value).sort()) {
    if (!is_public_document_attr_name(name)) return undefined;
    const decoded = decode_document_attr_value(name, value[name]);
    if (decoded === undefined) return undefined;
    attrs[name] = decoded;
  }
  return Object.freeze(attrs);
}

function canonical_style_map(value: unknown, ancestors: WeakSet<object>): CssMap | undefined {
  if (!is_plain_record(value)) return undefined;
  if (ancestors.has(value)) return undefined;
  ancestors.add(value);
  const style: Record<string, Primitive | CssMap> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (is_finite_primitive(item)) {
      style[key] = item;
      continue;
    }
    const nested = canonical_style_map(item, ancestors);
    if (nested === undefined) {
      ancestors.delete(value);
      return undefined;
    }
    style[key] = nested;
  }
  ancestors.delete(value);
  return Object.freeze(style);
}

function is_finite_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
