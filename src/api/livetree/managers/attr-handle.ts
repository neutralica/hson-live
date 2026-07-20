import { SVG_TAGS } from "../../../core/all-html-tags.js";
import { _META_DATA_PREFIX } from "../../../core/constants.js";
import { clone_node } from "../../../core/clone-node.js";
import {
  canonical_public_attrs_equal,
  decode_public_attrs,
  decode_public_attr_value,
  is_public_attr_name,
} from "../../../core/public-attrs.js";
import type {
  CanonicalPublicAttrs,
  CanonicalPublicAttrValue,
  HsonNode,
} from "../../../core/types.js";
import type { AttrHandle, FlagHandle } from "../../../types/attrs.types.js";
import type { SvgTag } from "../../../types/livetree.types.js";
import { serialize_style } from "../../transform/utils/attrs-utils/serialize-style.js";
import {
  canonical_svg_attr_name,
} from "../../transform/utils/html-utils/parse_html_attrs.js";
import {
  LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
  LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE,
  LiveTreeAttributeError,
} from "../livetree.error.js";
import type { LiveTree } from "../livetree.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";

const FLAG_NAMES = new WeakMap<HsonNode, Set<string>>();

function canonical_attr_key<TTree extends LiveTree>(tree: TTree, name: string): string {
  const lower = name.toLowerCase();
  return tree.svg.inScope() ? canonical_svg_attr_name(name) : lower;
}

function svg_attr_key_from_node_tag(node: HsonNode, name: string): string {
  const lower = name.toLowerCase();
  return SVG_TAGS.includes(node.$_tag as SvgTag) ? canonical_svg_attr_name(name) : lower;
}

export function attr_handle<TTree extends LiveTree>(tree: TTree): AttrHandle<TTree> {
  const must = Object.freeze({
    get: (name: string): CanonicalPublicAttrValue => {
      const key = normalize_attr_name(tree, name, "must.get");
      const value = read_canonical_attr(tree, key, "must.get");
      if (value === undefined) {
        throw new LiveTreeAttributeError(
          LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
          "must.get",
          tree.quid,
          `ordinary attribute ${JSON.stringify(key)} is absent`,
          { attributeName: key },
        );
      }
      return value;
    },
  });

  return Object.freeze({
    get: (name) => {
      const key = normalize_attr_name(tree, name, "get");
      return read_canonical_attr(tree, key, "get");
    },
    must,
    has: (name) => {
      const key = normalize_attr_name(tree, name, "has");
      return has_ordinary_attr(tree.node, key);
    },
    keys: () => Object.freeze(read_ordinary_attr_keys(tree.node)),
    set: (name, value) => {
      const key = normalize_attr_name(tree, name, "set");
      const decoded = normalize_attr_value(tree, key, value, "set");
      const current = read_ordinary_attrs(tree, "set");
      return apply_attrs_replacement(tree, current, normalize_attrs_result({ ...current, [key]: decoded }), [key]);
    },
    setMany: (values) => {
      const additions = normalize_attrs_input(tree, values, "setMany");
      const current = read_ordinary_attrs(tree, "setMany");
      return apply_attrs_replacement(
        tree,
        current,
        normalize_attrs_result({ ...current, ...additions }),
        Object.keys(additions),
      );
    },
    drop: (name) => {
      const key = normalize_attr_name(tree, name, "drop");
      const current = read_ordinary_attrs(tree, "drop");
      const next: Record<string, CanonicalPublicAttrValue> = { ...current };
      delete next[key];
      return apply_attrs_replacement(tree, current, normalize_attrs_result(next), []);
    },
    dropMany: (names) => {
      const normalized = normalize_drop_names(tree, names, "dropMany");
      const current = read_ordinary_attrs(tree, "dropMany");
      const next: Record<string, CanonicalPublicAttrValue> = { ...current };
      for (const name of normalized) delete next[name];
      return apply_attrs_replacement(tree, current, normalize_attrs_result(next), []);
    },
    clear: () => {
      const current = read_ordinary_attrs(tree, "clear");
      return apply_attrs_replacement(tree, current, Object.freeze({}), []);
    },
    replace: (values) => {
      const next = normalize_attrs_input(tree, values, "replace");
      const current = read_ordinary_attrs(tree, "replace");
      return apply_attrs_replacement(tree, current, next, Object.keys(next));
    },
  });
}

export function flag_handle<TTree extends LiveTree>(tree: TTree): FlagHandle<TTree> {
  return Object.freeze({
    has: (name) => {
      const key = canonical_attr_key(tree, name);
      const attrs = tree.node.$_attrs;
      return attrs !== undefined && Object.prototype.hasOwnProperty.call(attrs, key);
    },
    set: (...names): TTree => {
      for (const name of names) set_flag(tree, canonical_attr_key(tree, name));
      return tree;
    },
    clear: (...names): TTree => {
      for (const name of names) clear_flag(tree, canonical_attr_key(tree, name));
      return tree;
    },
  });
}

/** Canonical single-value writer retained for existing internal managers. */
export function setAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  name: string,
  value: CanonicalPublicAttrValue,
): TTree;
export function setAttrsImpl<TTree extends LiveTree>(tree: TTree, values: CanonicalPublicAttrs): TTree;
export function setAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  nameOrValues: string | CanonicalPublicAttrs,
  value?: CanonicalPublicAttrValue,
): TTree {
  if (typeof nameOrValues === "string") {
    return Reflect.apply(tree.attrs.set, tree.attrs, [nameOrValues, value]);
  }
  return tree.attrs.setMany(nameOrValues);
}

export function removeAttrImpl<TTree extends LiveTree>(tree: TTree, name: string): TTree {
  return tree.attrs.drop(name);
}

export function getAttrImpl(tree: LiveTree, name: string): CanonicalPublicAttrValue | undefined {
  return tree.attrs.get(name);
}

export function readAttrFromNode(
  node: HsonNode,
  name: string,
): CanonicalPublicAttrValue | undefined {
  const key = svg_attr_key_from_node_tag(node, name);
  if (!has_ordinary_attr(node, key)) return undefined;
  return decode_public_attr_value(key, node.$_attrs?.[key]);
}

export function hasAttrImpl(tree: LiveTree, name: string): boolean {
  return tree.attrs.has(name);
}

function read_canonical_attr(
  tree: LiveTree,
  key: string,
  operation: string,
): CanonicalPublicAttrValue | undefined {
  if (!has_ordinary_attr(tree.node, key)) return undefined;
  const decoded = decode_public_attr_value(key, tree.node.$_attrs?.[key]);
  if (decoded !== undefined) return decoded;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, key, "stored value is not canonical");
}

function has_ordinary_attr(node: HsonNode, key: string): boolean {
  const attrs = node.$_attrs;
  return attrs !== undefined
    && !flag_names_for_node(node).has(key)
    && Object.prototype.hasOwnProperty.call(attrs, key);
}

function read_ordinary_attr_keys(node: HsonNode): string[] {
  const flags = flag_names_for_node(node);
  return Object.keys(node.$_attrs ?? {})
    .filter((name) => is_public_attr_name(name) && !flags.has(name))
    .sort();
}

function read_ordinary_attrs(tree: LiveTree, operation: string): CanonicalPublicAttrs {
  const input: Record<string, unknown> = {};
  for (const name of read_ordinary_attr_keys(tree.node)) input[name] = tree.node.$_attrs?.[name];
  const attrs = decode_public_attrs(input);
  if (attrs !== undefined) return attrs;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, undefined, "stored ordinary attrs are not canonical");
}

function normalize_attr_name(tree: LiveTree, input: unknown, operation: string): string {
  if (typeof input !== "string") {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, undefined, "name must be a string");
  }
  const key = canonical_attr_key(tree, input);
  if (key.startsWith(_META_DATA_PREFIX)) {
    throw attr_error(tree, LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE, operation, key, "system metadata is protected");
  }
  if (!is_public_attr_name(key)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, key, "name is not a canonical bare HSON name");
  }
  return key;
}

function normalize_attr_value(
  tree: LiveTree,
  name: string,
  input: unknown,
  operation: string,
): CanonicalPublicAttrValue {
  const value = decode_public_attr_value(name, input);
  if (value !== undefined) return value;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, name, "value is not canonical");
}

function normalize_attrs_input(tree: LiveTree, input: unknown, operation: string): CanonicalPublicAttrs {
  if (!is_plain_record(input)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, undefined, "values must be an ordinary-attribute bag");
  }
  const normalized: Record<string, CanonicalPublicAttrValue> = {};
  const entries = Object.entries(input);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const [inputName, inputValue] = entry;
    try {
      const name = normalize_attr_name(tree, inputName, operation);
      normalized[name] = normalize_attr_value(tree, name, inputValue, operation);
    } catch (cause) {
      if (cause instanceof LiveTreeAttributeError) {
        throw new LiveTreeAttributeError(cause.code, operation, cause.quid, cause.reason, {
          attributeName: cause.attributeName,
          inputIndex: index,
        });
      }
      throw cause;
    }
  }
  return normalize_attrs_result(normalized);
}

function normalize_attrs_result(input: Readonly<Record<string, CanonicalPublicAttrValue>>): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(input);
  if (attrs === undefined) throw new Error("LiveTree attrs planner produced an invalid canonical bag");
  return attrs;
}

function normalize_drop_names(tree: LiveTree, input: unknown, operation: string): readonly string[] {
  if (!Array.isArray(input)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, undefined, "names must be an array");
  }
  return Object.freeze(input.map((name, index) => {
    try {
      return normalize_attr_name(tree, name, operation);
    } catch (cause) {
      if (cause instanceof LiveTreeAttributeError) {
        throw new LiveTreeAttributeError(cause.code, operation, cause.quid, cause.reason, {
          attributeName: cause.attributeName,
          inputIndex: index,
        });
      }
      throw cause;
    }
  }));
}

function apply_attrs_replacement<TTree extends LiveTree>(
  tree: TTree,
  current: CanonicalPublicAttrs,
  next: CanonicalPublicAttrs,
  overriddenFlags: readonly string[],
): TTree {
  if (canonical_public_attrs_equal(current, next) && overriddenFlags.every((name) => !flag_names_for_node(tree.node).has(name))) {
    return tree;
  }

  const node = tree.node;
  const flags = new Set(flag_names_for_node(node));
  for (const name of overriddenFlags) flags.delete(name);
  const combined: Record<string, CanonicalPublicAttrValue> = { ...next };
  for (const name of [...flags].sort()) {
    const value = node.$_attrs?.[name];
    if (value !== undefined) combined[name] = value;
  }
  const ordered = normalize_attrs_result(combined);
  if (Object.keys(ordered).length === 0) delete node.$_attrs;
  else node.$_attrs = clone_node(ordered);
  FLAG_NAMES.set(node, flags);
  project_attrs_replacement(node, current, next);
  return tree;
}

function project_attrs_replacement(
  node: HsonNode,
  current: CanonicalPublicAttrs,
  next: CanonicalPublicAttrs,
): void {
  const element = get_el_for_node(node);
  if (element === undefined) return;
  for (const name of Object.keys(current)) {
    if (!Object.prototype.hasOwnProperty.call(next, name)) element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next)) project_attr_value(element, name, value);
}

function project_attr_value(element: Element, name: string, value: CanonicalPublicAttrValue): void {
  if (name === "style" && typeof value === "object" && value !== null) {
    const cssText = serialize_style(value);
    if (cssText === "") element.removeAttribute(name);
    else element.setAttribute(name, cssText);
    return;
  }
  if (value === false || value === null) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value === true ? "" : String(value));
}

function flag_names_for_node(node: HsonNode): Set<string> {
  const existing = FLAG_NAMES.get(node);
  if (existing !== undefined) return existing;
  const inferred = new Set<string>();
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) {
    if (value === name) inferred.add(name);
  }
  FLAG_NAMES.set(node, inferred);
  return inferred;
}

function set_flag(tree: LiveTree, name: string): void {
  if (name === "style") {
    const attrs = tree.node.$_attrs;
    if (attrs !== undefined) delete attrs.style;
    get_el_for_node(tree.node)?.removeAttribute("style");
    return;
  }
  const node = tree.node;
  const attrs = node.$_attrs ??= {};
  attrs[name] = name;
  flag_names_for_node(node).add(name);
  get_el_for_node(node)?.setAttribute(name, name);
}

function clear_flag(tree: LiveTree, name: string): void {
  const node = tree.node;
  if (node.$_attrs !== undefined) {
    delete node.$_attrs[name];
    if (Object.keys(node.$_attrs).length === 0) delete node.$_attrs;
  }
  flag_names_for_node(node).delete(name);
  get_el_for_node(node)?.removeAttribute(name);
}

function attr_error(
  tree: LiveTree,
  code: ConstructorParameters<typeof LiveTreeAttributeError>[0],
  operation: string,
  attributeName: string | undefined,
  reason: string,
): LiveTreeAttributeError {
  return new LiveTreeAttributeError(code, operation, tree.quid, reason, { attributeName });
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
