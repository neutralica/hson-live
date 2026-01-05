// attrs-manager.ts

import { HsonAttrs, HsonNode } from "../../../types-consts/node.types";
import { parse_style_string } from "../../../utils/attrs-utils/parse-style";
import { serialize_style } from "../../../utils/attrs-utils/serialize-style";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { LiveTree } from "../livetree";
import { CssMap } from "../../../types-consts/css.types";
import { Primitive } from "../../../types-consts/core.types";

/**
 * Apply a single attribute to a HSON node and keep the corresponding DOM
 * element in sync.
 *
 * Semantics:
 * - `value === null` or `value === false` → remove the attribute from both
 *   the HSON `_attrs` map and the DOM.
 * - `value === true` or a "flag" usage → set a boolean-present attribute
 *   by storing `key="key"` in `_attrs` and mirroring that on the DOM.
 * - any other value → stringified and stored as a normal attribute value.
 *
 * Special case: `"style"`
 * - The node stores a parsed `StyleObject` representation (CSS property map).
 * - The DOM receives canonical CSS text generated via `serialize_style()`.
 * - `null`, `false`, or `true` for `"style"` are treated as "clear/remove style".
 *
 * Attribute names are normalized to lowercase for storage and DOM sync.
 *
 * @param node - The HSON node whose attributes are being mutated.
 * @param name - Attribute name (case-insensitive; internally lowercased).
 * @param value - Attribute value to apply. Controls removal, boolean-present
 *                semantics, or normal string value as described above. If
 *                `undefined`, it is treated as `null` (removal).
 */
export function applyAttrToNode(
  node: HsonNode,
  name: string,
  value: Primitive | undefined,
): void {
  if (!node._attrs) node._attrs = {};
  const attrs = node._attrs as HsonAttrs & { style?: CssMap };

  const key = name.toLowerCase();
  const el = element_for_node(node) as HTMLElement | undefined;

  // normalize undefined -> null
  if (value === undefined) {
    value = null;
  }

  // ---- remove / delete ----------------------------------------
  if (value === null || value === false) {
    if (key === "style") {
      delete attrs.style;
      if (el) el.removeAttribute("style");
    } else {
      delete (attrs as any)[key];
      if (el) el.removeAttribute(key);
    }
    return;
  }

  // ---- boolean-present attribute ------------------------------
  if (value === true) {
    if (key === "style") {
      // treat boolean style as "clear style"
      delete attrs.style;
      if (el) el.removeAttribute("style");
    } else {
      // CANONICAL: store flag as key="key" in _attrs
      (attrs as any)[key] = key;
      if (el) el.setAttribute(key, key);
    }
    return;
  }

  // ---- normal value -------------------------------------------
  const s = String(value);

  if (key === "style") {
    const cssObj = parse_style_string(s) as CssMap;
    attrs.style = cssObj;

    const cssText = serialize_style(cssObj);
    if (el) {
      if (cssText) {
        el.setAttribute("style", cssText);
      } else {
        el.removeAttribute("style");
      }
    }
  } else {
    (attrs as any)[key] = s;
    if (el) el.setAttribute(key, s);
  }
}
/**
 * Read a single attribute from a HSON node, treating the node as the
 * source of truth rather than the DOM.
 *
 * Behavior:
 * - If the attribute is not present, returns `undefined`.
 * - For most attributes, returns the stored primitive value from `_attrs`.
 *   Boolean-present attributes previously written by `applyAttrToNode`
 *   will typically read back as the attribute-name string (e.g. `"disabled"`).
 * - For `"style"`, if the stored value is a `StyleObject`, it is serialized
 *   to canonical CSS text via `serialize_style()` and returned as a string.
 *
 * This function does not touch the DOM; it only inspects the node’s
 * internal attribute map.
 *
 * @param node - The HSON node to read from.
 * @param name - Attribute name (case-insensitive; matched in lowercase).
 * @returns The stored attribute value as a `Primitive`, or `undefined` if
 *          the attribute is not present.
 */
export function readAttrFromNode(
  node: HsonNode,
  name: string,
): Primitive | undefined {
  const attrs = node._attrs;
  if (!attrs) return undefined;

  const key = name.toLowerCase();
  const raw = (attrs as any)[key];

  if (raw == null) return undefined;

  if (key === "style" && typeof raw === "object") {
    // convert StyleObject2 → CSS text
    return serialize_style(raw as Record<string, string>);
  }

  return raw as Primitive;
}

/**
 * Set one or more attributes on the given `LiveTree`'s node, using
 * `applyAttrToNode` for consistent HSON + DOM semantics.
 *
 * Overloads:
 * - `nameOrMap` is a string:
 *   - `value` is used as the attribute value.
 *   - `undefined` is treated as `null`, which removes the attribute.
 * - `nameOrMap` is a record:
 *   - Each key/value pair is applied in turn.
 *   - `undefined` values are normalized to `null` (removal).
 *
 * This is the low-level implementation behind higher-level `.attr()`-style
 * APIs and assumes `tree.node` is bound; mutators are allowed to throw if
 * there is no underlying node.
 *
 * @param tree - The `LiveTree` whose node will receive the attributes.
 * @param nameOrMap - Either a single attribute name or a map of names to values.
 * @param value - The attribute value when `nameOrMap` is a string. Optional;
 *                omitted or `undefined` is treated as `null` (removal).
 * @returns The same `LiveTree` instance, for chaining.
 */
export function setAttrsImpl(
  tree: LiveTree,
  nameOrMap: string | Record<string, string | boolean | null>,
  value?: Primitive
): LiveTree {
  const node = tree.node; // mutators are allowed to throw if unbound

  if (typeof nameOrMap === "string") {
    applyAttrToNode(node, nameOrMap, (value) ?? null);
    return tree;
  }

  for (const [k, v] of Object.entries(nameOrMap)) {
    applyAttrToNode(node, k, (v) ?? null);
  }
  return tree;
}
/**
 * Remove a single attribute from the given `LiveTree`'s node, using
 * `applyAttrToNode` with a `null` value to trigger removal semantics.
 *
 * This clears the attribute from both the HSON `_attrs` map and the
 * corresponding DOM element, if present.
 *
 * @param tree - The `LiveTree` whose node will be mutated.
 * @param name - The attribute name to remove (case-insensitive).
 * @returns The same `LiveTree` instance, for chaining.
 */
export function removeAttrImpl(tree: LiveTree, name: string): LiveTree {
  const node = tree.node;
  applyAttrToNode(node, name, null);
  return tree;
}
/**
 * Set one or more boolean-present attributes (flags) on the given
 * `LiveTree`'s node.
 *
 * Each flag name is passed to `applyAttrToNode` with `true` as the value,
 * resulting in canonical storage as `key="key"` in `_attrs` and a the key word 
 * present as an attribute (no ="") on the DOM element.
 *
 * @param tree - The `LiveTree` whose node will receive the flags.
 * @param names - One or more attribute names to set as boolean-present flags.
 * @returns The same `LiveTree` instance, for chaining.
 */
export function setFlagsImpl(tree: LiveTree, ...names: string[]): LiveTree {
  const node = tree.node;
  for (const n of names) {
    applyAttrToNode(node, n, true);
  }
  return tree;
}
/**
 * Clear one or more boolean-present attributes (or any attributes) from
 * the given `LiveTree`'s node.
 *
 * Each named attribute is removed by calling `applyAttrToNode` with a
 * `null` value, which deletes it from `_attrs` and from the DOM element.
 *
 * @param tree - The `LiveTree` whose node will be mutated.
 * @param names - One or more attribute names to remove.
 * @returns The same `LiveTree` instance, for chaining.
 */
export function clearFlagsImpl(tree: LiveTree, ...names: string[]): LiveTree {
  const node = tree.node;
  for (const n of names) {
    applyAttrToNode(node, n, null);
  }
  return tree;
}
/**
 * Read a single attribute from the given `LiveTree`'s node, delegating
 * to `readAttrFromNode`.
 *
 * This inspects only the HSON node’s `_attrs` map; it does not read
 * from the DOM directly.
 *
 * @param tree - The `LiveTree` whose node will be queried.
 * @param name - Attribute name to read (case-insensitive).
 * @returns The attribute value as a `Primitive`, or `undefined` if
 *          the attribute is not present.
 */
export function getAttrImpl(tree: LiveTree, name: string): Primitive | undefined {
  return readAttrFromNode(tree.node, name);
}
