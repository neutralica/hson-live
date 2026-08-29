// livemap-node.ts

import { ELEM_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type { LivePath } from "../../types/livemap.types.js";
import { resolve_wrapper_node } from "./livemap.editor.js";

/**
 * Resolve a LiveMap node path for private, read-oriented inspection.
 *
 * Projected JSON wrapper resolution runs first so JSON data remains canonical
 * when JSON keys overlap with HTML tag names. The child-tag fallback exists for
 * HTML-shaped Hson, where element nodes may sit behind `_hson_elem` clusters.
 * This module is not exported through a supported package entrypoint.
 */
export function resolveLiveMapNode(root: HsonNode, path: LivePath): HsonNode | undefined {
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
