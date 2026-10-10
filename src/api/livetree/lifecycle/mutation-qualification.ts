import type { HsonNode, NodeContent } from "../../../core/types.js";
import { is_Node } from "../../../core/node-guards.js";
import { ELEM_TAG, OBJ_TAG, ROOT_TAG } from "../../../core/constants.js";
import { qualify_exact_hson_graph, type ExactHsonRole } from "../../../internal/exact-node-qualification.js";
import { parent_for_node } from "./graph-ownership.js";
import { LiveTreeAlreadyAttachedError } from "../livetree.error.js";

/** Visit physical placements, not a deduplicated graph-value view. */
export function placement_nodes(roots: readonly HsonNode[], operation: string): HsonNode[] {
  const seen = new Set<HsonNode>(), result: HsonNode[] = [], stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) throw new LiveTreeAlreadyAttachedError(operation);
    seen.add(node);
    Object.defineProperty(result, result.length, { value: node, writable: true, enumerable: true, configurable: true });
    for (const child of node.$_content) if (is_Node(child)) {
      Object.defineProperty(stack, stack.length, { value: child, writable: true, enumerable: true, configurable: true });
    }
  }
  return result;
}

/** Structural proof for mutable owner storage. Runtime managers also store
 * form arrays and scalar styles; those are not portable attribute admission. */
export function qualify_owned_structure(node: HsonNode, role: ExactHsonRole, operation: string): void {
  const copies = new Map<HsonNode, HsonNode>();
  const nodes = placement_nodes([node], operation);
  for (const source of nodes) copies.set(source, { $_tag: source.$_tag, $_content: [],
    ...(source.$_meta?.index === undefined ? {} : { $_meta: { index: source.$_meta.index } }) });
  for (const source of nodes) copies.get(source)!.$_content = source.$_content.map(value => is_Node(value) ? copies.get(value)! : value);
  qualify_exact_hson_graph(copies.get(node)!, operation, role, true);
}

export function receiver_role(node: HsonNode): ExactHsonRole {
  if (node.$_tag === ROOT_TAG) return "document-root";
  if (parent_for_node(node)?.$_tag === OBJ_TAG) return "member";
  return "runtime-branch";
}

export function qualify_owned_content(node: HsonNode, content: NodeContent, operation: string): void {
  qualify_owned_structure({ $_tag: node.$_tag, $_content: content }, receiver_role(node), operation);
}

export function assert_element_receiver(node: HsonNode, operation: string): void {
  qualify_owned_structure(node, receiver_role(node), operation);
  if (parent_for_node(node)?.$_tag === OBJ_TAG
    || (node.$_content.length !== 0 && (!is_Node(node.$_content[0]) || node.$_content[0].$_tag !== ELEM_TAG))) {
    throw new Error(`${operation} requires an element-content receiver.`);
  }
}
