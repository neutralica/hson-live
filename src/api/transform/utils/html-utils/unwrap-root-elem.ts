// unwrap-root-elem.ts

import { ROOT_TAG, ELEM_TAG } from "../../../../core/constants.js";
import { HsonNode } from "../../../../core/types.js";
import { is_Node } from "../../../../core/node-guards.js";


/**
 * Unwrap a parsed HSON container shape (`_hson_root` → `_hson_elem`) into its concrete child nodes.
 *
 * This normalizes inputs that may be wrapped by the parser (or produced by transforms)
 * so downstream mutators can operate on “real” nodes rather than structural wrappers.
 *
 * Behavior:
 * - If a node is `_hson_root` whose first child is an `_hson_elem`, returns the `_hson_elem`’s child nodes.
 * - Otherwise, returns the node wrapped in a single-item array.
 * - Always returns an array.
 *
 * @param content - A single node or list of nodes that may include `_hson_root`/`_hson_elem` wrappers.
 * @returns The unwrapped concrete child nodes (stripped of `_hson_root`/`_hson_elem` wrapper nodes).
 */
export function unwrap_root_elem(content: HsonNode | HsonNode[]): HsonNode[] {
    const nodes = Array.isArray(content) ? content : [content];
    
    /* use flatMap to handle nodes that might expand into multiple children */
    return nodes.flatMap(node => {
        if (node.$_tag === ROOT_TAG) {
            const childNode = node.$_content?.[0];
            /* if it's a valid container, return its children */
            if (is_Node(childNode) && childNode.$_tag === ELEM_TAG) {
                return childNode.$_content?.filter(is_Node) || [];
            } 
        }
        /* if it's not a container, just return the node itself */
        return [node];
    });
}
