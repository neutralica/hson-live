// serialize-json.new.render.ts

import { JsonObj, Primitive } from "../../types/core.types";
import { assert_invariants } from "../../diagnostics/assert-invariants.test";
import { is_indexed } from "../../utils/node-utils/node-guards";
import { ROOT_TAG, EVERY_VSN, ARR_TAG, OBJ_TAG, STR_TAG, VAL_TAG, ELEM_TAG, II_TAG } from "../../consts/constants";
import {  HsonNode } from "../../types/node.types";
import { JsonValue } from "../../types/core.types";
import { clone_node } from "../../utils/node-utils/clone-node";
import { make_string } from "../../utils/primitive-utils/make-string.nodes.utils";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";

/**
 * Serialize a well-formed HSON tree to JSON text.
 *
 * Pipeline:
 * 1. Clone & validate:
 *    - `clone_node($node)` creates a defensive copy so the original IR is not
 *      mutated by any downstream fixes or assertions.
 *    - `assert_invariants(clone, "serialize_json")` guarantees the node
 *      satisfies all structural invariants expected of HSON 2.0 before
 *      attempting to emit JSON.
 *
 * 2. Structural conversion:
 *    - Delegates to `jsonFromNode(clone)` to convert the HSON tree into a
 *      plain `JsonValue` (object/array/primitive), resolving:
 *        - VSNs (`_root`, `_obj`, `_arr`, `_elem`, `_ii`, `_str`, `_val`)
 *        - Standard tags (HTML-like and user-defined)
 *      into standard JS shapes.
 *
 * 3. Stringification:
 *    - Uses `make_string(serializedJson)` (a thin wrapper over
 *      `JSON.stringify` with project-level defaults) to produce the final
 *      JSON string.
 *
 * 4. Error handling:
 *    - Any failure during the stringify step is caught and wrapped in
 *      `_throw_transform_err` with a clear origin `"serialize-json"`.
 *
 * Guarantees:
 * - Input must be a valid `HsonNode` that passes invariants, or an error is
 *   thrown.
 * - Output is a JSON string representing the same logical data that produced
 *   the HSON tree (modulo the HSON-to-JSON mapping rules in `jsonFromNode`).
 *
 * @param $node - The root HSON node to serialize.
 * @returns A JSON string representation of the node.
 * @throws If invariants fail or if `make_string` throws during stringify.
 */
export function serialize_json($node: HsonNode): string {
    const clone = clone_node($node)
    assert_invariants(clone, 'serialize_json')
    const serializedJson = jsonFromNode(clone);
    try {
        const json = make_string(serializedJson);
        return json;
    } catch (e: any) {
        _throw_transform_err(`error during final JSON.stringify\n ${e.message}`, 'serialize-json');
    }
}

/**
 * Recursively convert a HSON node into a JSON-shaped `JsonValue`.
 *
 * This is the core structural converter behind `serialize_json`. It walks
 * the HSON IR, interprets VSN tags, and reconstructs the nearest equivalent
 * JavaScript value (object, array, or primitive).
 *
 * Tag-by-tag semantics:
 *
 * - `_root`:
 *   - Must have exactly one child.
 *   - That child is taken as the true data cluster; `_root` itself is not
 *     reflected in the JSON surface.
 *
 * - `_arr`:
 *   - Expects `_content` to be a list of `_ii` index nodes.
 *   - Each `_ii` is unwrapped and converted; the resulting array preserves
 *     element order and ignores the index metadata.
 *
 * - `_obj`:
 *   - If `_content` has a single child that is one of:
 *       `_str`, `_val`, `_arr`, `_obj`, `_elem`
 *     then this wrapper is treated as transparent and the child’s JSON
 *     representation is returned directly. This mirrors the “cluster”
 *     behavior in the rest of the system.
 *   - Otherwise:
 *     - Each child is treated as a property node:
 *       - The tag name (`propNode._tag`) becomes the object key.
 *       - The first child of that property node is converted recursively
 *         and used as the value.
 *     - Produces a plain `JsonObj` whose keys correspond to these tag names.
 *
 * - `_str` / `_val`:
 *   - Return their single primitive payload directly:
 *     - `_str` → string
 *     - `_val` → number | boolean | null
 *
 * - `_elem`:
 *   - Represents “element cluster” semantics in JSON form.
 *   - Each child in `_content` is converted recursively.
 *   - The result is wrapped as `{ "_elem": [ ...items ] }`, so that element
 *     mode remains distinguishable at the JSON layer.
 *
 * - `_ii`:
 *   - Index wrapper used inside `_arr`.
 *   - Must contain exactly one child node.
 *   - Unwrapped and converted directly via `jsonFromNode` on that child.
 *
 * - Default branch (standard or user-defined tag, e.g. `"div"`, `"recipe"`):
 *   - Build a property object of the shape:
 *       `{ [tag]: <payload>, _attrs?, _meta? }`
 *   - Content:
 *       - No children  → `{ [tag]: "" }` (empty string payload)
 *       - One child    → `{ [tag]: jsonFromNode(child) }`
 *       - Multiple children → error (a standard tag is not allowed to have
 *         multiple content clusters at this stage).
 *   - Attributes:
 *       - If `_attrs` is present and non-empty, it is attached as `_attrs`
 *         on the same object, merged with any existing `_attrs`.
 *   - Meta:
 *       - If `_meta` is present and non-empty, it is attached as `_meta`
 *         without further filtering; meta is preserved as-is in JSON mode.
 *
 * Safety / guardrails:
 * - Rejects any tag that starts with `_` but is not a known VSN
 *   (`EVERY_VSN`), to avoid leaking unknown control tags into JSON.
 * - For `_root`, `_arr`, `_ii`, `_elem`, and cluster shapes, checks that
 *   structural expectations are met (e.g., `_root` has exactly one child,
 *   `_ii` has exactly one child, etc.).
 *
 * @param $node - The HSON node to convert.
 * @returns A `JsonValue` (object, array, or primitive) suitable for
 *   `JSON.stringify`.
 * @throws If the node shape violates HSON invariants or contains unknown
 *   VSN-like tags.
 */
function jsonFromNode($node: HsonNode): JsonValue {

    if (!$node || (typeof $node._tag !== 'string')) {
        console.warn('warning! node is type: ', typeof $node);
        _throw_transform_err(`Invalid node or node tag`, 'serialize_json');
    }

        if ($node._tag.startsWith("_") && !EVERY_VSN.includes($node._tag)) {
            _throw_transform_err(`unknown VSN-like tag: <${$node._tag}>`, 'parse-html');
        }
    
    /* step 1: catch VSNs */

    switch ($node._tag) {
        case ROOT_TAG: {
            if (!$node._content || $node._content.length !== 1) {
               console.error(make_string($node))
                _throw_transform_err('malformed _root node -  must have exactly one child', 'serialize_json');
            }
            // The recursive call now expects the child to be in the NEW format.
            return jsonFromNode($node._content[0] as HsonNode);
        }

        case ARR_TAG: {
            let array: JsonValue[] = [];
            if ($node._content) {
                /*  content of _array node must be _ii nodes */
                for (const iiNode of $node._content as HsonNode[]) {
                    if (is_indexed(iiNode)) {
                        array.push(jsonFromNode(iiNode._content[0] as HsonNode));
                    } else {
                        _throw_transform_err(`malformed _ii node in _array`, 'serialize-json');
                    }
                }
            }
            return array;
        }

        case OBJ_TAG: {
            const jsonObj: JsonObj = {};
            if ($node._content && $node._content.length === 1) {
                const only = $node._content[0] as HsonNode;
                // unwrap primitive/array/object/elem wrappers produced by the parser
                if (only._tag === STR_TAG || only._tag === VAL_TAG || only._tag === ARR_TAG || only._tag === OBJ_TAG || only._tag === ELEM_TAG) {
                    return jsonFromNode(only); // <- avoids calling with a primitive later
                }
            }
            if ($node._content) {
                for (const propNode of $node._content as HsonNode[]) {
                    const key = propNode._tag;
                    let value: JsonValue = {};
                    if (propNode._content && propNode._content.length > 0) {
                        const child = propNode._content[0];
                        // assign directly; do NOT Object.assign into {}
                        value = jsonFromNode(child as HsonNode);
                    }
                    jsonObj[key] = value as JsonValue;
                }
            }
            return jsonObj;
        }


        case STR_TAG:
        case VAL_TAG: {
            /* return Primitive content directly */
            return $node._content[0] as Primitive;
        }

        case ELEM_TAG: {
            /* _elem tags are native to HTML and will be carried through the JSON as-is; the only 
                exceptional handling is the contents of _elem tags are not rewrapped in an _obj */
            const elemItems: JsonValue = [];
            for (const itemNode of ($node._content)) {
                /* recursively convert each item node in the _elem to its JSON equivalent */
                const jsonItem = jsonFromNode(itemNode as HsonNode);
                elemItems.push(jsonItem);
            }
            return { [ELEM_TAG]: elemItems };
        }
        case II_TAG: {
            if (!$node._content || $node._content.length !== 1) {
                _throw_transform_err('misconfigured _ii node', 'serialize_json');
            }
            return jsonFromNode($node._content[0] as HsonNode);
        }

        default: { /* "standard" tag (e.g. "foo", "kingdom", "html", "p", "span") */

            let tempJson: JsonObj = {};
            if ($node._content && $node._content.length === 0) {
                tempJson = { [$node._tag]: '' };
            } else if ($node._content && $node._content.length === 1) {
                const recursed = jsonFromNode($node._content[0] as HsonNode);
                tempJson = { [$node._tag]: recursed };
            } else if ($node._content && $node._content.length > 1) {
                /*  This implies a cluster of values if a standard tag has multiple content VSNs
                    (should be rare or never) */
                _throw_transform_err(`<${$node._tag}> has multiple content VSN children`, 'serialize_json');
            }

            /* handle _meta */
            const hasAttrs = $node._attrs && Object.keys($node._attrs).length > 0;
            const hasMeta = $node._meta && Object.keys($node._meta).length > 0;
            const finalJson: JsonObj = tempJson;

            if (hasAttrs) {
                (finalJson as any)._attrs = {
                    ...(finalJson as any)._attrs,
                    ...($node._attrs as Record<string, unknown>)
                };
            }

            // meta stays as-is
            if (hasMeta) {
                (finalJson as any)._meta = $node._meta;
            }
            return finalJson;
        }
    }
}
