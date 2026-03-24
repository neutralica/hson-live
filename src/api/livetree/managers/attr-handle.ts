import { SVG_TAGS } from "../../../consts/html-tags.js";
import { AttrHandle, FlagHandle } from "../../../types/attrs.types.js";
import { Primitive } from "../../../types/core.types.js";
import { HsonNode, HsonAttrs, CssMap } from "../../../types/index.js";
import { SvgTag } from "../../../types/livetree.types.js";
import { AttrMap, AttrValue } from "../../../types/node.types.js";
import { parse_style_string } from "../../../utils/attrs-utils/parse-style.js";
import { serialize_style } from "../../../utils/attrs-utils/serialize-style.js";
import { canonical_svg_attr_name, SVG_ATTR_CASE_MAP } from "../../../utils/html-utils/parse_html_attrs.js";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers.js";
import { LiveTree } from "../livetree.js";

function canonical_attr_key<TTree extends LiveTree>(tree: TTree, name: string): string {
  const lower = name.toLowerCase();

  // TODO change to .svg.isSvg when exists
  if (!SVG_TAGS.includes(tree.node._tag as SvgTag)) return lower;

  return SVG_ATTR_CASE_MAP[lower] ?? lower;
}
function canonical_attr_key_from_node(node: HsonNode, name: string): string {
  const lower = name.toLowerCase();

  if (!SVG_TAGS.includes(node._tag as SvgTag)) return lower;

  return SVG_ATTR_CASE_MAP[lower] ?? lower;
}
export function attr_handle<TTree extends LiveTree>(tree: TTree): AttrHandle<TTree> {
  return Object.freeze({
    get: (name) => getAttrImpl(tree, canonical_attr_key(tree, name)),

    has: (name) => getAttrImpl(tree, canonical_attr_key(tree, name)) !== undefined,

    drop: (name): TTree => {
      removeAttrImpl(tree, canonical_attr_key(tree, name));
      return tree;
    },

    set: (name, value): TTree => {
      setAttrsImpl(tree, canonical_attr_key(tree, name), value);
      return tree;
    },

    setMany: (map): TTree => {
      for (const [k, v] of Object.entries(map)) {
        setAttrsImpl(tree, canonical_attr_key(tree, k), v);
      }
      return tree;
    },
  });
}

export function flag_handle<TTree extends LiveTree>(tree: TTree): FlagHandle<TTree> {
  return Object.freeze({
    has: (name) => attr_handle(tree).has(name),
    set: (...names): TTree => setFlagsImpl(tree, ...names),
    clear: (...names): TTree => clearFlagsImpl(tree, ...names),
  });
}


/* ---------------------------------------------
 * Core single-attr apply/read
 * ------------------------------------------- */

/**
 * CHANGED: accepts Primitive (number supported) and preserves:
 * - null/false/undefined => remove
 * - true => boolean-present attr (key="key") except style clears
 * - string/number => set stringified
 */
export function applyAttrToNode(
  node: HsonNode,
  name: string,
  value: AttrValue,
): void {
  if (!node._attrs) node._attrs = {};
  const attrs = node._attrs as HsonAttrs & { style?: CssMap };

  const key = canonical_attr_key_from_node(node, name);
  const el = element_for_node(node) as Element | undefined;

  // CHANGED: normalize undefined -> null (removal)
  const v: Primitive = (value === undefined ? null : value);

  // ---- remove / delete ----------------------------------------
  // CHANGED: `false` means remove (if you want literal "false", pass "false")
  if (v === null || v === false) {
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
  if (v === true) {
    if (key === "style") {
      // treat boolean style as "clear style"
      delete attrs.style;
      if (el) el.removeAttribute("style");
    } else {
      (attrs as any)[key] = key;
      if (el) el.setAttribute(key, key);
    }
    return;
  }

  // ---- normal value -------------------------------------------
  // CHANGED: numbers become strings here
  const s = String(v);

  if (key === "style") {
    // CHANGED: parse+store structured style map, mirror canonical text to DOM
    const cssObj = parse_style_string(s) as CssMap;
    attrs.style = cssObj;

    const cssText = serialize_style(cssObj);
    if (el) {
      if (cssText) el.setAttribute("style", cssText);
      else el.removeAttribute("style");
    }
  } else {
    (attrs as any)[key] = s;
    if (el) el.setAttribute(key, s);
  }
}

/**
 * Read a single attribute from the node (IR is source of truth).
 * - missing => undefined
 * - style object => serialized css text
 */
export function readAttrFromNode(
  node: HsonNode,
  name: string,
): Primitive | undefined {
  const attrs = node._attrs;
  if (!attrs) return undefined;

  const key = canonical_attr_key_from_node(node, name);
  const raw = (attrs as any)[key];

  if (raw == null) return undefined;

  if (key === "style" && typeof raw === "object") {
    return serialize_style(raw as Record<string, string>);
  }

  return raw as Primitive;
}

/* ---------------------------------------------
 * LiveTree-facing helpers
 * ------------------------------------------- */

/**
 * CHANGED: accepts Primitive map + numbers; undefined => remove
 *
 * Overloads kept for ergonomics.
 */
export function setAttrsImpl<TTree extends LiveTree>(tree: TTree, name: string, value: AttrValue): TTree;
export function setAttrsImpl<TTree extends LiveTree>(tree: TTree, map: AttrMap): TTree;
export function setAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  nameOrMap: string | AttrMap,
  value?: AttrValue,
): TTree {
  const node = tree.node;

  if (typeof nameOrMap === "string") {
    applyAttrToNode(node, nameOrMap, value);
    return tree;
  }

  for (const [k, v] of Object.entries(nameOrMap)) {
    applyAttrToNode(node, k, v);
  }
  return tree;
}

export function removeAttrImpl<TTree extends LiveTree>(tree: TTree, name: string): TTree {
  // CHANGED: removal uses undefined->null normalization inside apply
  applyAttrToNode(tree.node, name, null);
  return tree;
}

/**
 * Set boolean-present attrs. (style treated as clear, per applyAttrToNode)
 */
export function setFlagsImpl<TTree extends LiveTree>(tree: TTree, ...names: string[]): TTree {
  const node = tree.node;
  for (const n of names) {
    applyAttrToNode(node, n, true);
  }
  return tree;
}

/**
 * Clear boolean-present attrs (and any attr, really).
 */
export function clearFlagsImpl<TTree extends LiveTree>(tree: TTree, ...names: string[]): TTree {
  const node = tree.node;
  for (const n of names) {
    applyAttrToNode(node, n, null);
  }
  return tree;
}

export function getAttrImpl(tree: LiveTree, name: string): Primitive | undefined {
  return readAttrFromNode(tree.node, name);
}

/**
 * Optional helper if you want a canonical "hasAttr" that means “present”
 * even for flags stored as key="key".
 */
export function hasAttrImpl(tree: LiveTree, name: string): boolean {
  // CHANGED: key-exists check avoids edge cases where value could be ""
  const attrs = tree.node._attrs;
  if (!attrs) return false;
  const key = canonical_attr_key_from_node(tree.node, name);
  return (attrs as any)[key] != null;
}