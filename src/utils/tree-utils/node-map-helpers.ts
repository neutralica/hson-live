// node-map-helpers.ts

import { HsonNode } from "../../types/node.types.js";
import { NODE_ELEMENT_MAP } from "../../consts/constants.js";
import { make_string } from "../primitive-utils/make-string.nodes.utils.js";


/**
 * Associate a live DOM `Element` with an `HsonNode` in the internal node→element map.
 *
 * This is the single, canonical registration point for establishing the linkage used
 * by DOM-sync operations (style, dataset, append/remove, detach, etc.).
 *
 * Notes:
 * - Uses a `WeakMap`, so entries are eligible for GC when the `HsonNode` is no longer referenced.
 * - Overwrites any prior mapping for the same node.
 *
 * @param node - The HSON node that conceptually “owns” the element.
 * @param el - The concrete DOM element that represents `node` in the live document.
 */
export function linkNodeToElement(node: HsonNode, el: Element): void {
  NODE_ELEMENT_MAP.set(node, el);
}
//  optional helpers
/**
 * Remove any existing node→element association for the given `HsonNode`.
 *
 * Use this when a node is being detached/unmounted so future sync calls do not
 * accidentally target a stale element reference.
 *
 * @param node - The node whose mapping should be removed.
 */
export function unlinkNode(node: HsonNode): void {
  NODE_ELEMENT_MAP.delete(node);
}
/**
 * Check whether an `HsonNode` currently has an associated live DOM `Element`.
 *
 * This is a convenience wrapper around the underlying `WeakMap.has`.
 *
 * @param node - The node to test.
 * @returns `true` if a mapping exists, otherwise `false`.
 */
export function hasElementForNode(node: HsonNode): boolean {
  return NODE_ELEMENT_MAP.has(node);
}

/**
 * Policy for `element_for_node_checked` when an unexpected element is found.
 */
export type ElementLookupPolicy = "throw" | "warn" | "silent";

/**
 * Resolve the DOM element mapped to a given HSON node.
 *
 * @param node - HSON node to resolve.
 * @returns The mapped DOM element, or `undefined` if none exists.
 */
export function element_for_node(node: HsonNode): Element | undefined {
  return NODE_ELEMENT_MAP.get(node);
}

// NEW: opt-in tripwire
/**
 * Resolve the mapped DOM element and optionally assert tag invariants.
 *
 * @param node - HSON node to resolve.
 * @param purpose - Short label included in error/warn output.
 * @param policy - Action to take when an unexpected element is found.
 * @returns The mapped DOM element, or `undefined` if none exists.
 */
export function element_for_node_checked(
  node: HsonNode,
  purpose: string,
  policy: ElementLookupPolicy = "throw",
): Element | undefined {
  const el = NODE_ELEMENT_MAP.get(node);
  if (!el) return undefined;

  // DOM tagName comes back uppercase in HTML.
  // `_TAG` showing up means something created `<_tag>` / `<_TAG>` in the DOM.
  const tag = el.tagName;

  // Invariant: no HSON virtual/internal tags should ever exist as DOM elements.
  // If you allow custom elements, they still shouldn't start with "_".
  if (tag.startsWith("_")) {
    const quid = node._meta?._quid ?? "<no-quid>";
    const msg = `[element_for_node_checked] unexpected DOM element tag "${tag}" for purpose="${purpose}" (node._tag=${node._tag}, quid=${quid})`;

    if (policy === "warn") {
      console.warn(msg, { node, el });
      return el;
    }
    if (policy === "throw") {
      throw new Error(msg);
    }
  }

  return el;
}
