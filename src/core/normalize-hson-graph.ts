import {
  ELEM_OBJ_ARR,
  ELEM_TAG,
  EVERY_VSN,
  OBJ_TAG,
  VAL_TAG,
} from "./constants.js";
import { canonical_inline_style } from "./inline-style.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "./types.js";

function is_plain_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function is_primitive(value: unknown): value is Primitive {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function fail(where: string, path: string, message: string): never {
  throw new Error(`[HSON normalization] ${message} in ${where} at ${path}`);
}

function optional_record(
  value: unknown,
  field: "$_attrs" | "$_meta",
  where: string,
  path: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return fail(where, path, `${field} must be a plain object when present`);
  }
  if (!is_plain_record(value)) {
    return fail(where, path, `${field} must be a plain object when present`);
  }
  return Object.keys(value).length === 0 ? undefined : value;
}

/**
 * Normalize the explicitly supported permissive node-ingress forms without
 * mutating the caller. Shared acyclic references remain shared; cycles fail
 * with the current path and the path where the active reference began.
 */
export function normalize_hson_graph(input: HsonNode, where: string): HsonNode {
  const active = new WeakMap<object, string>();
  const complete = new WeakMap<object, HsonNode>();
  let changed = false;

  const visit = (value: unknown, path: string, parentTag: string | null): HsonNode => {
    if (!is_plain_record(value)) return fail(where, path, "node must be a plain object");

    const origin = active.get(value);
    if (origin !== undefined) {
      return fail(where, path, `cycle detected (reference returns to ${origin})`);
    }
    const existing = complete.get(value);
    if (existing) return existing;

    const tag = value.$_tag;
    if (typeof tag !== "string") return fail(where, path, "node has invalid $_tag");
    if (!Array.isArray(value.$_content)) {
      return fail(where, `${path}/${tag}`, "node must carry an array $_content");
    }

    const here = `${path}/${tag}`;
    active.set(value, here);
    const result: HsonNode = { $_tag: tag, $_content: [] };

    const hasMeta = Object.hasOwn(value, "$_meta");
    const meta = hasMeta
      ? optional_record(value.$_meta, "$_meta", where, here)
      : undefined;
    if (hasMeta && meta === undefined) changed = true;
    if (meta) result.$_meta = Object.fromEntries(Object.entries(meta)) as HsonMeta;

    const hasAttrs = Object.hasOwn(value, "$_attrs");
    const attrs = hasAttrs
      ? optional_record(value.$_attrs, "$_attrs", where, here)
      : undefined;
    if (hasAttrs && attrs === undefined) changed = true;
    if (attrs) {
      const entries: Array<[string, HsonAttrs[string]]> = [];
      for (const [key, item] of Object.entries(attrs)) {
        if (item === undefined) {
          changed = true;
          continue;
        }
        if (key === "style") {
          if (typeof item === "string") {
            entries.push([key, item]);
            continue;
          }
          const style = canonical_inline_style(item);
          if (style === undefined) {
            return fail(
              where,
              `${here}/$_attrs.style`,
              `malformed attribute value for "style"; style must use the canonical inline-style value domain`,
            );
          }
          entries.push([key, style]);
        } else {
          if (!is_primitive(item)) {
            return fail(where, `${here}/$_attrs.${key}`, "ordinary attribute value must be string|number|boolean|null");
          }
          if (typeof item === "string") {
            entries.push([key, item]);
          } else {
            changed = true;
            entries.push([key, String(item)]);
          }
        }
      }
      if (entries.length > 0) result.$_attrs = Object.fromEntries(entries);
    }

    const content = value.$_content.map((child, index) =>
      is_plain_record(child)
        ? visit(child, `${here}/$_content[${index}]`, tag)
        : child
    );
    if (!EVERY_VSN.includes(tag)) {
      if (content.length === 1
        && is_plain_record(content[0])
        && typeof content[0].$_tag === "string"
        && ELEM_OBJ_ARR.includes(content[0].$_tag)) {
        result.$_content = content as Array<HsonNode | Primitive>;
      } else {
        changed = true;
        const needsObjectMode = content.length > 0
          && (parentTag === OBJ_TAG
            || content.some((child) => is_plain_record(child) && child.$_tag === VAL_TAG));
        result.$_content = [{
          $_tag: needsObjectMode ? OBJ_TAG : ELEM_TAG,
          $_content: content as Array<HsonNode | Primitive>,
        }];
      }
    } else {
      result.$_content = content as Array<HsonNode | Primitive>;
    }

    active.delete(value);
    complete.set(value, result);
    return result;
  };

  const normalized = visit(input, "", null);
  if (changed) return normalized;
  return input;
}
