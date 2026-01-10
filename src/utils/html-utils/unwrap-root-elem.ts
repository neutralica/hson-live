// unwrap-root-elem.ts

import { ROOT_TAG, ELEM_TAG } from "../../consts/constants";
import { HsonNode } from "../../types-consts/node.types";
import { is_Node } from "../node-utils/node-guards";


/**
 * Unwrap a parsed HSON container shape (`_root` → `_elem`) into its concrete child nodes.
 *
 * This normalizes inputs that may be wrapped by the parser (or produced by transforms)
 * so downstream mutators can operate on “real” nodes rather than structural wrappers.
 *
 * Behavior:
 * - If a node is `_root` whose first child is an `_elem`, returns the `_elem`’s child nodes.
 * - Otherwise, returns the node wrapped in a single-item array.
 * - Always returns an array.
 *
 * @param content - A single node or list of nodes that may include `_root`/`_elem` wrappers.
 * @returns The unwrapped concrete child nodes (no `_root`/`_elem` wrapper nodes).
 */
export function unwrap_root_elem(content: HsonNode | HsonNode[]): HsonNode[] {
    const nodes = Array.isArray(content) ? content : [content];
    
    /* use flatMap to handle nodes that might expand into multiple children */
    return nodes.flatMap(node => {
        if (node._tag === ROOT_TAG) {
            const childNode = node._content?.[0];
            /* if it's a valid container, return its children */
            if (is_Node(childNode) && childNode._tag === ELEM_TAG) {
                return childNode._content?.filter(is_Node) || [];
            } 
        }
        /* if it's not a container, just return the node itself */
        return [node];
    });
}
