import {
  ARR_TAG,
  ELEM_OBJ_ARR,
  ELEM_TAG,
  EVERY_VSN,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "./constants.js";
import { analyze_hson_array_indexes } from "./hson-array-indexes.js";
import { classify_ordinary_hson_structure } from "./hson-structural-mode.js";
import { is_Node } from "./node-guards.js";
import { canonical_inline_style } from "./inline-style.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "./types.js";
import { hsonNumber } from "./hson-number.js";

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

  const visit = (
    value: unknown,
    path: string,
    parentTag: string | null,
    requiredMode?: "element" | "object",
  ): HsonNode => {
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
    if (tag === ROOT_TAG && hasMeta && Array.isArray(value.$_meta)) {
      return fail(where, here, "$_meta must be a plain object when present");
    }
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

    const childRequiredMode = tag === ELEM_TAG
      ? "element"
      : tag === OBJ_TAG
        ? "object"
        : !EVERY_VSN.includes(tag)
          ? requiredMode
          : undefined;
    let content = value.$_content.map((child, index) => {
      if (is_plain_record(child)) {
        return visit(child, `${here}/$_content[${index}]`, tag, childRequiredMode);
      }
      return tag === VAL_TAG && typeof child === "number"
        ? hsonNumber(child)
        : child;
    });
    if (tag === ARR_TAG) {
      const analysis = analyze_hson_array_indexes(content);
      if (!analysis.valid) return fail(where, here, analysis.reason);
      if (analysis.reordered) {
        changed = true;
        content = [...analysis.canonical];
      }
    }
    if (tag === II_TAG && content.length === 1 && is_Node(content[0]) && !EVERY_VSN.includes(content[0].$_tag)) {
      return fail(where, here, "direct ordinary _hson_ii child must be wrapped by _hson_obj");
    }
    if (!EVERY_VSN.includes(tag)) {
      if (content.length === 0) {
        result.$_content = [];
      } else if (content.length === 1
        && is_Node(content[0])
        && ELEM_OBJ_ARR.includes(content[0].$_tag)) {
        if (content[0].$_tag === ELEM_TAG && content[0].$_content.length === 0) {
          changed = true;
          result.$_content = [];
        } else {
          result.$_content = content as Array<HsonNode | Primitive>;
        }
      } else if (content.length === 1
        && is_Node(content[0])
        && (content[0].$_tag === STR_TAG || content[0].$_tag === VAL_TAG)) {
        if (requiredMode === "element" && content[0].$_tag === VAL_TAG) {
          return fail(where, here, "ordinary node content crosses its element parent branch");
        }
        changed = true;
        result.$_content = [{
          $_tag: requiredMode === "element" ? ELEM_TAG : OBJ_TAG,
          $_content: content as Array<HsonNode | Primitive>,
        }];
      } else {
        if (content.some((child) => !is_Node(child))) {
          return fail(where, here, "ordinary node must place primitive payloads inside a structural wrapper");
        }
        if (content.some((child) => is_Node(child) && ELEM_OBJ_ARR.includes(child.$_tag))) {
          return fail(where, here, "ordinary node has contradictory or redundant structural wrappers");
        }

        const childModes = content.flatMap<"element" | "object">((child) => {
          if (!is_Node(child)) return [];
          // String leaves are valid in both element mixed content and object
          // scalar relationships; the containing branch supplies the mode.
          if (child.$_tag === STR_TAG) return [];
          if (child.$_tag === VAL_TAG) return ["object"];
          if (EVERY_VSN.includes(child.$_tag)) return [];
          const structure = classify_ordinary_hson_structure(child);
          if (structure.kind === "empty-element" || structure.kind === "element") return ["element"];
          if (structure.kind === "object" || structure.kind === "object-scalar" || structure.kind === "array") return ["object"];
          return [];
        });
        const hasElement = childModes.includes("element");
        const hasObject = childModes.includes("object");
        if (hasElement && hasObject) {
          return fail(where, here, "ordinary node content mixes element and object structural modes");
        }
        const inferredMode = requiredMode ?? (hasObject ? "object" : "element");
        if ((requiredMode === "element" && hasObject) || (requiredMode === "object" && hasElement)) {
          return fail(where, here, `ordinary node content crosses its ${requiredMode} parent branch`);
        }
        changed = true;
        result.$_content = [{
          $_tag: inferredMode === "object" ? OBJ_TAG : ELEM_TAG,
          $_content: content as Array<HsonNode | Primitive>,
        }];
      }

      const structure = classify_ordinary_hson_structure(result);
      if (structure.kind === "invalid") return fail(where, here, structure.reason);
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
