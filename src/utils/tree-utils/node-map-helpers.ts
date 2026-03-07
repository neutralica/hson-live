// node-map-helpers.ts

import { HsonNode } from "../../types/node.types.js";
import { make_string } from "../primitive-utils/make-string.nodes.utils.js";

/***************************************************************
 * NODE_ELEMENT_MAP / ELEMENT_NODE_MAP
 *
 * Canonical bi-directional runtime bridge between HSON nodes
 * and their live DOM elements.
 *
 * Invariant:
 * - one node -> one element
 * - one element -> one node
 *
 * All writes must go through linkNodeToElement / unlinkNode / unlinkElement.
 ***************************************************************/

const NODE_ELEMENT_MAP = new WeakMap<HsonNode, Element>();

const ELEMENT_NODE_MAP = new WeakMap<Element, HsonNode>();


/**
 * Link one node to one element, cleaning up any stale prior pairings on either side.
 */
export function linkNodeToElement(node: HsonNode, el: Element): void {
  // CHANGED: clear any previous element for this node
  const prevEl = NODE_ELEMENT_MAP.get(node);
  if (prevEl && prevEl !== el) {
    ELEMENT_NODE_MAP.delete(prevEl);
  }

  // CHANGED: clear any previous node for this element
  const prevNode = ELEMENT_NODE_MAP.get(el);
  if (prevNode && prevNode !== node) {
    unlinkNode(prevNode);
  }

  // CHANGED: write both directions
  NODE_ELEMENT_MAP.set(node, el);
  ELEMENT_NODE_MAP.set(el, node);
}


/**
 * Remove both directions for a node, if present.
 */
export function unlinkNode(node: HsonNode): void {
  const el = NODE_ELEMENT_MAP.get(node);

  NODE_ELEMENT_MAP.delete(node);

  if (el) {
    const mappedNode = ELEMENT_NODE_MAP.get(el);
    if (mappedNode === node) {
      ELEMENT_NODE_MAP.delete(el);
    }
  }
}

/**
 * Remove both directions for an element, if present.
 */
export function unlinkElement(el: Element): void {
  const node = ELEMENT_NODE_MAP.get(el);

  ELEMENT_NODE_MAP.delete(el);

  if (node) {
    const mappedEl = NODE_ELEMENT_MAP.get(node);
    if (mappedEl === el) {
      NODE_ELEMENT_MAP.delete(node);
    }
  }
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
export function hasNodeForEl(el: Element): boolean {
  return ELEMENT_NODE_MAP.has(el);
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

export function node_for_element(el: Element): HsonNode | undefined {
  return ELEMENT_NODE_MAP.get(el);
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

export function assert_node_element_link(node: HsonNode): void {
  const el = element_for_node(node);
  if (!el) return;

  const roundTrip = node_for_element(el);
  if (roundTrip !== node) {
    throw new Error("node<->element map mismatch");
  }
}
