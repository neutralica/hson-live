// livemap-node.ts

import { ELEM_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import { HsonNode } from "../../core/types.js";
import { resolve_wrapper_node } from "./livemap.editor.js";
import { LivePath, LiveMapNodeHandle, LiveMapNodeAttrs, LiveMapNodeAttrValue } from "../../types/livemap.types.js";
import { format_live_path } from "./livemap.path.js";
import { prune_empty_node_attrs } from "../../core/node-storage.js";

const EMPTY_NODE_ATTRS: LiveMapNodeAttrs = Object.freeze({});

/** Remove only child nodes and preserve primitive content. */
function removeChildNodes(parent: HsonNode): void {
  parent.$_content = parent.$_content.filter((child) => !is_Node(child));
}

function childContentIndex(parent: HsonNode, path: LivePath, index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw childIndexError(path, index);
  }

  let childIndex = -1;

  for (let indexInContent = 0; indexInContent < parent.$_content.length; indexInContent += 1) {
    if (!is_Node(parent.$_content[indexInContent])) continue;

    childIndex += 1;
    if (childIndex === index) return indexInContent;
  }

  throw childIndexError(path, index);
}

function childIndexError(path: LivePath, index: number): Error {
  return new Error(`LiveMap node child index does not resolve: ${format_live_path(path)}[${index}]`);
}

function childInsertContentIndex(parent: HsonNode, path: LivePath, index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw childIndexError(path, index);
  }

  let childIndex = 0;

  for (let indexInContent = 0; indexInContent < parent.$_content.length; indexInContent += 1) {
    if (!is_Node(parent.$_content[indexInContent])) continue;
    if (childIndex === index) return indexInContent;
    childIndex += 1;
  }

  if (childIndex === index) return parent.$_content.length;

  throw childIndexError(path, index);
}

function insertChildNodeAt(parent: HsonNode, path: LivePath, index: number, child: HsonNode): void {
  const contentIndex = childInsertContentIndex(parent, path, index);
  parent.$_content.splice(contentIndex, 0, child);
}

function moveChildNodeAt(parent: HsonNode, path: LivePath, fromIndex: number, toIndex: number): void {
  const fromContentIndex = childContentIndex(parent, path, fromIndex);
  const [child] = parent.$_content.splice(fromContentIndex, 1);
  if (!is_Node(child)) return;

  const toContentIndex = childInsertContentIndex(parent, path, toIndex);
  parent.$_content.splice(toContentIndex, 0, child);
}

function removeChildNodeAt(parent: HsonNode, path: LivePath, index: number): void {
  const contentIndex = childContentIndex(parent, path, index);
  parent.$_content.splice(contentIndex, 1);
}

/** Replace child nodes while preserving primitive content already on the node. */
function replaceChildNodes(parent: HsonNode, children: readonly HsonNode[]): void {
  parent.$_content = [...parent.$_content.filter((child) => !is_Node(child)), ...children];
}

function replaceChildNodeAt(parent: HsonNode, path: LivePath, index: number, child: HsonNode): void {
  const contentIndex = childContentIndex(parent, path, index);
  parent.$_content.splice(contentIndex, 1, child);
}

/**
 * Create a HSON-node-facing handle for one projected LiveMap path.
 *
 * This is the lower-level HSON graph toolbox: precise node resolution,
 * inspection, attrs editing, and surgical child-node content mutation. `$_meta`
 * remains system-owned and read-only from this surface.
 *
 * Resolution is intentionally ordered: projected JSON wrapper resolution wins
 * first, then direct child-tag lookup, then transparent descent through
 * _hson_elem clusters. That means JSON data with a key like "button" resolves
 * as JSON-backed data, not as an HTML element, and still fails attrs mutation
 * unless its resolved wrapper is actually _hson_elem-backed.
 *
 * Node-handle mutations edit the underlying HSON graph directly. They are for
 * element/graph work, not JSON-state commits: they do not use LiveMap `set`,
 * `setMany`, `replace`, `delete`, schema validation, or commit events.
 *
 * This surface is exposed only through `map.debug.node(...)`. It mutates the
 * owned HSON graph directly and bypasses projected writes, schema validation,
 * commits, revisions, feeds, subscriptions, and ordinary LiveMap state
 * guarantees. Avoid it in normal application state code.
 */
export function make_livemap_node_handle(
  root: HsonNode,
  path: LivePath,
  invalidateAuthority: () => void = () => {},
  assertMutationAllowed: () => void = () => {},
): LiveMapNodeHandle {
  const handlePath = [...path];
  const getNode = () => resolveLiveMapNode(root, handlePath);
  const mustNode = () => mustResolveNode(root, handlePath);
  const mustAttrsNode = () => mustResolveAttrsNode(root, handlePath);

  const handle: LiveMapNodeHandle = {
    path: () => [...handlePath],
    get: getNode,
    must: () => mustNode(),
    tag: () => getNode()?.$_tag,
    attrs: () => {
      const node = getNode();
      return node === undefined ? undefined : copyAttrs(node.$_attrs);
    },
    attr: (name) => getNode()?.$_attrs?.[name],
    setAttr: (name, value) => {
      assertMutationAllowed();
      setNodeAttr(mustAttrsNode(), name, value);
      invalidateAuthority();
      return handle;
    },
    setAttrs: (attrs) => {
      assertMutationAllowed();
      setNodeAttrs(mustAttrsNode(), attrs);
      invalidateAuthority();
      return handle;
    },
    removeAttr: (name) => {
      assertMutationAllowed();
      removeNodeAttr(mustAttrsNode(), name);
      invalidateAuthority();
      return handle;
    },
    clearAttrs: () => {
      assertMutationAllowed();
      clearNodeAttrs(mustAttrsNode());
      invalidateAuthority();
      return handle;
    },
    meta: () => getNode()?.$_meta,
    content: () => getNode()?.$_content,
    children: () => copyChildNodes(getNode()),
    childrenByTag: (tag: string) => copyChildNodesByTag(getNode(), tag),
    child: (tag: string) => findDirectChildNodeByTag(getNode(), tag),
    mustChild: (tag: string) => mustFindDirectChildNodeByTag(root, handlePath, tag),
    append: (child: HsonNode) => {
      assertMutationAllowed();
      appendChildNode(mustNode(), child);
      invalidateAuthority();
      return handle;
    },
    insert: {
      child: (index, child) => {
        assertMutationAllowed();
        insertChildNodeAt(mustNode(), handlePath, index, child);
        invalidateAuthority();
        return handle;
      },
    },
    move: {
      child: (fromIndex, toIndex) => {
        assertMutationAllowed();
        moveChildNodeAt(mustNode(), handlePath, fromIndex, toIndex);
        invalidateAuthority();
        return handle;
      },
    },
    remove: {
      children: () => {
        assertMutationAllowed();
        removeChildNodes(mustNode());
        invalidateAuthority();
        return handle;
      },
      child: (index) => {
        assertMutationAllowed();
        removeChildNodeAt(mustNode(), handlePath, index);
        invalidateAuthority();
        return handle;
      },
    },
    replace: {
      children: (children) => {
        assertMutationAllowed();
        replaceChildNodes(mustNode(), children);
        invalidateAuthority();
        return handle;
      },
      child: (index, child) => {
        assertMutationAllowed();
        replaceChildNodeAt(mustNode(), handlePath, index, child);
        invalidateAuthority();
        return handle;
      },
    },
  };

  return handle;
}

function mustResolveNode(root: HsonNode, path: LivePath): HsonNode {
  const node = resolveLiveMapNode(root, path);
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
function mustResolveAttrsNode(root: HsonNode, path: LivePath): HsonNode {
  const node = mustResolveNode(root, path);
  if (canEditNodeAttrs(node)) return node;

  throw new Error(`LiveMap node attrs can only be edited on _hson_elem-backed nodes: ${format_live_path(path)}`);
}

function canEditNodeAttrs(node: HsonNode): boolean {
  return node.$_content.some((child) => is_Node(child) && child.$_tag === ELEM_TAG);
}

function copyAttrs(attrs: HsonNode["$_attrs"] | undefined): LiveMapNodeAttrs {
  if (attrs === undefined) return EMPTY_NODE_ATTRS;
  return { ...attrs };
}

function setNodeAttr(node: HsonNode, name: string, value: LiveMapNodeAttrValue): void {
  node.$_attrs = {
    ...node.$_attrs,
    [name]: value,
  };
}

function setNodeAttrs(node: HsonNode, attrs: Readonly<Record<string, LiveMapNodeAttrValue>>): void {
  node.$_attrs = {
    ...node.$_attrs,
    ...attrs,
  };
}

function removeNodeAttr(node: HsonNode, name: string): void {
  const attrs = node.$_attrs;
  if (attrs === undefined || !(name in attrs)) return;

  const next = { ...attrs };
  delete next[name];

  if (Object.keys(next).length > 0) {
    node.$_attrs = next;
    return;
  }

  delete node.$_attrs;
  prune_empty_node_attrs(node);
}

function clearNodeAttrs(node: HsonNode): void {
  delete node.$_attrs;
}

function copyChildNodes(node: HsonNode | undefined): readonly HsonNode[] {
  if (node === undefined) return [];
  return node.$_content.filter(is_Node);
}

function copyChildNodesByTag(node: HsonNode | undefined, tag: string): readonly HsonNode[] {
  if (node === undefined) return [];
  return node.$_content.filter((child): child is HsonNode => is_Node(child) && child.$_tag === tag);
}

function findDirectChildNodeByTag(node: HsonNode | undefined, tag: string): HsonNode | undefined {
  if (node === undefined) return undefined;
  return node.$_content.find((child): child is HsonNode => is_Node(child) && child.$_tag === tag);
}

function mustFindDirectChildNodeByTag(root: HsonNode, path: LivePath, tag: string): HsonNode {
  const child = findDirectChildNodeByTag(mustResolveNode(root, path), tag);
  if (child !== undefined) return child;

  throw new Error(`LiveMap node child does not resolve: ${format_live_path(path)}.${JSON.stringify(tag)}`);
}

function appendChildNode(parent: HsonNode, child: HsonNode): void {
  parent.$_content.push(child);
}

/**
 * Resolve a LiveMap node path.
 *
 * Projected JSON wrapper resolution runs first so JSON data remains canonical
 * when JSON keys overlap with HTML tag names. The child-tag fallback exists for
 * HTML-shaped HSON, where element nodes may sit behind _hson_elem clusters rather
 * than the projected JSON object/value clusters used by state data.
 */
function resolveLiveMapNode(root: HsonNode, path: LivePath): HsonNode | undefined {
  return resolve_wrapper_node(root, path) ?? resolveChildNodePath(root, path);
}

function resolveChildNodePath(root: HsonNode, path: LivePath): HsonNode | undefined {
  let current: HsonNode | undefined = root;

  for (const part of path) {
    if (current === undefined || typeof part !== "string") return undefined;
    current = findChildNodeByTag(current, part);
  }

  return current;
}

function findChildNodeByTag(parent: HsonNode, tag: string): HsonNode | undefined {
  const direct = parent.$_content.find((child): child is HsonNode => is_Node(child) && child.$_tag === tag);
  if (direct !== undefined) return direct;

  return parent.$_content
    .filter((child): child is HsonNode => is_Node(child) && child.$_tag === ELEM_TAG)
    .map((elemCluster) => findChildNodeByTag(elemCluster, tag))
    .find((child) => child !== undefined);
}
