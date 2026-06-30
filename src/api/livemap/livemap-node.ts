// livemap-node.ts

import type { HsonNode } from "../../core/types.js";
import { ELEM_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { LiveMapNodeAttrs, LiveMapNodeAttrValue, LiveMapNodeHandle, LivePath } from "./livemap.types.js";
import { resolve_wrapper_node } from "./livemap-editor.js";
import { format_live_path } from "./livemap-path.js";


/**
 * Create a HSON-node-facing handle for one projected LiveMap path.
 *
 * This is the beginning of the lower-level HSON graph toolbox: precise node
 * resolution, inspection, attrs editing, and eventually surgical content
 * mutation. `_meta` remains system-owned and read-only from this surface.
 *
 * Resolution is intentionally ordered: projected JSON wrapper resolution wins
 * first, then direct child-tag lookup, then transparent descent through
 * _hson_elem clusters. That means JSON data with a key like "button" resolves
 * as JSON-backed data, not as an HTML element, and still fails attrs mutation
 * unless its resolved wrapper is actually _hson_elem-backed.
 */
export function make_livemap_node_handle(root: HsonNode, path: LivePath): LiveMapNodeHandle {
  const handlePath = [...path];
  const getNode = () => resolve_livemap_node(root, handlePath);

  const handle: LiveMapNodeHandle = {
    path: () => [...handlePath],
    get: getNode,
    must: () => must_resolve_node(root, handlePath),
    tag: () => getNode()?.$_tag,
    attrs: () => copy_attrs(getNode()?.$_attrs),
    attr: (name) => getNode()?.$_attrs?.[name],
    setAttr: (name, value) => {
      set_node_attr(must_resolve_attrs_node(root, handlePath), name, value);
      return handle;
    },
    setAttrs: (attrs) => {
      set_node_attrs(must_resolve_attrs_node(root, handlePath), attrs);
      return handle;
    },
    removeAttr: (name) => {
      remove_node_attr(must_resolve_attrs_node(root, handlePath), name);
      return handle;
    },
    clearAttrs: () => {
      clear_node_attrs(must_resolve_attrs_node(root, handlePath));
      return handle;
    },
    meta: () => getNode()?.$_meta,
    content: () => getNode()?.$_content,
  };

  return handle;
}

function must_resolve_node(root: HsonNode, path: LivePath): HsonNode {
  const node = resolve_livemap_node(root, path);
  if (node !== undefined) return node;

  throw new Error(`LiveMap node path does not resolve: ${format_live_path(path)}`);
}

/**
 * Resolve a node for attrs mutation.
 *
 * Attrs are an HTML/element concern, not a universal HSON data concern. JSON
 * object wrappers may have ordinary tags such as "button", but they should not
 * receive $_attrs unless the wrapper contains an _hson_elem child cluster.
 */
function must_resolve_attrs_node(root: HsonNode, path: LivePath): HsonNode {
  const node = must_resolve_node(root, path);
  if (can_edit_node_attrs(node)) return node;

  throw new Error(`LiveMap node attrs can only be edited on _hson_elem-backed nodes: ${format_live_path(path)}`);
}

function can_edit_node_attrs(node: HsonNode): boolean {
  return node.$_content.some((child) => is_Node(child) && child.$_tag === ELEM_TAG);
}

function copy_attrs(attrs: HsonNode["$_attrs"] | undefined): LiveMapNodeAttrs | undefined {
  if (attrs === undefined) return undefined;
  return { ...attrs };
}

function set_node_attr(node: HsonNode, name: string, value: LiveMapNodeAttrValue): void {
  node.$_attrs = {
    ...node.$_attrs,
    [name]: value,
  };
}

function set_node_attrs(node: HsonNode, attrs: Readonly<Record<string, LiveMapNodeAttrValue>>): void {
  node.$_attrs = {
    ...node.$_attrs,
    ...attrs,
  };
}

function remove_node_attr(node: HsonNode, name: string): void {
  const attrs = node.$_attrs;
  if (attrs === undefined || !(name in attrs)) return;

  const next = { ...attrs };
  delete next[name];

  if (Object.keys(next).length > 0) {
    node.$_attrs = next;
    return;
  }

  node.$_attrs = {};
}

function clear_node_attrs(node: HsonNode): void {
  node.$_attrs = {};
}

/**
 * Resolve a LiveMap node path.
 *
 * Projected JSON wrapper resolution runs first so JSON data remains canonical
 * when JSON keys overlap with HTML tag names. The child-tag fallback exists for
 * HTML-shaped HSON, where element nodes may sit behind _hson_elem clusters rather
 * than the projected JSON object/value clusters used by state data.
 */
function resolve_livemap_node(root: HsonNode, path: LivePath): HsonNode | undefined {
  return resolve_wrapper_node(root, path) ?? resolve_child_node_path(root, path);
}

function resolve_child_node_path(root: HsonNode, path: LivePath): HsonNode | undefined {
  let current: HsonNode | undefined = root;

  for (const part of path) {
    if (current === undefined || typeof part !== "string") return undefined;
    current = find_child_node_by_tag(current, part);
  }

  return current;
}

function find_child_node_by_tag(parent: HsonNode, tag: string): HsonNode | undefined {
  const direct = parent.$_content.find((child): child is HsonNode => is_Node(child) && child.$_tag === tag);
  if (direct !== undefined) return direct;

  return parent.$_content
    .filter((child): child is HsonNode => is_Node(child) && child.$_tag === ELEM_TAG)
    .map((elemCluster) => find_child_node_by_tag(elemCluster, tag))
    .find((child) => child !== undefined);
}