// serialize-json.ts

import { JsonObj, Primitive } from "../../../core/types.js";
import { assert_invariants } from "../../../core/assert-invariants.js";
import { collect_hson_node_quid_claims } from "../../../core/hson-node-quid.js";
import { is_Node, is_indexed } from "../../../core/node-guards.js";
import { ROOT_TAG, EVERY_VSN, ARR_TAG, OBJ_TAG, STR_TAG, VAL_TAG, ELEM_TAG, II_TAG, HSON_SYS_PREFIX, ATTRS_KEY, META_KEY } from "../../../core/constants.js";
import {  HsonNode } from "../../../core/types.js";
import { JsonValue } from "../../../core/types.js";
import { clone_node } from "../../../core/clone-node.js";
import { make_string } from "../../../core/stringify.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import {
    is_projected_value_hson_node,
    projected_value_from_hson_node,
} from "../../../core/projected-value-graph.js";
import { materialize_projected_value } from "../../../core/projected-value-materialization.js";
import {
    ordered_projected_array,
    ordered_projected_object,
    type OrderedProjectedValue,
} from "../../../core/ordered-projected-value.js";
import {
    emit_ordered_json,
    ordered_json_from_runtime_value,
} from "../utils/json-utils/ordered-json.js";

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
 *    - Projects the HSON tree into an internal ordered JSON representation,
 *      resolving:
 *        - VSNs (`_hson_root`, `_hson_obj`, `_hson_arr`, `_hson_elem`, `_hson_ii`, `_hson_str`, `_hson_val`)
 *        - Standard tags (HTML-like and user-defined)
 *      into standard JS shapes.
 *
 *    - Object properties remain explicit entry sequences from the canonical
 *      graph through emission; they never cross a plain JavaScript object.
 *
 * 3. Stringification:
 *    - Uses the ordered JSON emitter so object-property order remains exact
 *      and negative zero retains the valid JSON spelling `-0`.
 *
 * 4. Error handling:
 *    - Any failure during the stringify step is caught and wrapped in
 *      `_throw_transform_err` with a clear origin `"serialize-json"`.
 *
 * Guarantees:
 * - Input must be a valid `HsonNode` that passes invariants, or an error is
 *   thrown.
 * - Output is a JSON string representing the same logical data that produced
 *   the HSON tree (modulo the established HSON-to-JSON mapping rules).
 *
 * @param $node - The root HSON node to serialize.
 * @returns A JSON string representation of the node.
 * @throws If invariants fail or final JSON emission fails.
 */
export function serialize_json($node: HsonNode): string {
    const serializedJson = ordered_json_value_from_node($node);
    try {
        const json = emit_ordered_json(serializedJson);
        return json;
    } catch (e: any) {
        _throw_transform_err(`error during final JSON.stringify\n ${e.message}`, 'serialize-json');
    }
}

/**
 * Project a canonical graph into an internal JSON value whose object branches
 * retain explicit entry sequences. This representation exists only between
 * graph admission and text emission; it is never exposed as caller JSON.
 */
function ordered_json_value_from_node($node: HsonNode): OrderedProjectedValue {
    assert_invariants($node, "serialize_json");
    collect_hson_node_quid_claims($node);
    const clone = collapse_redundant_roots(clone_node($node));
    assert_invariants(clone, "serialize_json");
    if (is_projected_value_hson_node(clone)) {
        return projected_value_from_hson_node(clone);
    }
    return orderedJsonFromNode(clone);
}

function orderedJsonFromNode(node: HsonNode): OrderedProjectedValue {
    if (!node || typeof node.$_tag !== "string") {
        _throw_transform_err("Invalid node or node tag", "serialize_json");
    }
    if (node.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(node.$_tag)) {
        _throw_transform_err(`unknown VSN-like tag: <${node.$_tag}>`, "serialize_json");
    }

    switch (node.$_tag) {
        case ROOT_TAG: {
            const only = node.$_content[0];
            if (node.$_content.length !== 1 || !is_Node(only)) {
                _throw_transform_err("malformed _hson_root node - must have exactly one child", "serialize_json");
            }
            return orderedJsonFromNode(only);
        }
        case ARR_TAG: {
            return ordered_projected_array(node.$_content.map((wrapper) => {
                if (!is_Node(wrapper) || !is_indexed(wrapper)) {
                    _throw_transform_err("malformed _hson_ii node in _hson_arr", "serialize-json");
                }
                return orderedJsonFromNode(wrapper.$_content[0] as HsonNode);
            }));
        }
        case OBJ_TAG: {
            if (node.$_content.length === 1 && is_Node(node.$_content[0])) {
                const only = node.$_content[0];
                if (only.$_tag === STR_TAG || only.$_tag === VAL_TAG || only.$_tag === ARR_TAG
                    || only.$_tag === OBJ_TAG || only.$_tag === ELEM_TAG) {
                    return orderedJsonFromNode(only);
                }
            }
            return ordered_projected_object(node.$_content.map((property) => {
                if (!is_Node(property)) {
                    _throw_transform_err("malformed property node in _hson_obj", "serialize-json");
                }
                const child = property.$_content[0];
                const value = is_Node(child)
                    ? orderedJsonFromNode(child)
                    : ordered_projected_object([]);
                return [property.$_tag, value] as const;
            }));
        }
        case STR_TAG:
        case VAL_TAG:
            return node.$_content[0] as Primitive;
        case ELEM_TAG:
            return ordered_projected_object([[
                ELEM_TAG,
                ordered_projected_array(node.$_content.map((child) => {
                    if (!is_Node(child)) {
                        _throw_transform_err("malformed child in _hson_elem", "serialize-json");
                    }
                    return orderedJsonFromNode(child);
                })),
            ]]);
        case II_TAG: {
            if (node.$_content.length !== 1 || !is_Node(node.$_content[0])) {
                _throw_transform_err("misconfigured _hson_ii node", "serialize_json");
            }
            return orderedJsonFromNode(node.$_content[0]);
        }
        default: {
            let payload: OrderedProjectedValue;
            if (node.$_content.length === 0) {
                payload = ordered_projected_object([[ELEM_TAG, ordered_projected_array([])]]);
            } else if (node.$_content.length === 1 && is_Node(node.$_content[0])) {
                payload = orderedJsonFromNode(node.$_content[0]);
            } else {
                _throw_transform_err(`<${node.$_tag}> has multiple content VSN children`, "serialize_json");
            }

            const entries: Array<readonly [string, OrderedProjectedValue]> = [[node.$_tag, payload]];
            if (node.$_attrs && Object.keys(node.$_attrs).length > 0) {
                entries.push([ATTRS_KEY, ordered_json_from_runtime_value(node.$_attrs as JsonValue)]);
            }
            if (node.$_meta && Object.keys(node.$_meta).length > 0) {
                entries.push([META_KEY, ordered_json_from_runtime_value(node.$_meta as JsonValue)]);
            }
            return ordered_projected_object(entries);
        }
    }
}

/**
 * Serialize the JSON projection without collapsing IEEE-754 negative zero.
 *
 * `JSON.stringify(-0)` emits `0`, even though `-0` is a valid JSON numeric
 * spelling and canonical HSON graph equality distinguishes the two runtime
 * values. The transport therefore owns its numeric emission rather than
 * delegating numbers to `JSON.stringify`.
 */
export function serialize_json_value(value: JsonValue, depth = 0): string {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            _throw_transform_err(
                `cannot serialize non-finite JSON number ${String(value)}`,
                "serialize-json",
            );
        }
        return Object.is(value, -0) ? "-0" : JSON.stringify(value);
    }

    const indent = "  ".repeat(depth);
    const childIndent = "  ".repeat(depth + 1);
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return `[` + "\n"
            + value.map((child) => `${childIndent}${serialize_json_value(child, depth + 1)}`).join(",\n")
            + `\n${indent}]`;
    }

    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{` + "\n"
        + entries.map(([key, child]) =>
            `${childIndent}${JSON.stringify(key)}: ${serialize_json_value(child, depth + 1)}`
        ).join(",\n")
        + `\n${indent}}`;
}

/** Project a canonical HSON graph directly to its in-memory JSON value. */
export function json_value_from_node($node: HsonNode): JsonValue {
    // JSON projection is still a canonical HsonNode egress boundary even
    // though projected application JSON intentionally omits node identity.
    assert_invariants($node, "serialize_json");
    collect_hson_node_quid_claims($node);
    const clone = collapse_redundant_roots(clone_node($node))
    assert_invariants(clone, 'serialize_json')
    if (is_projected_value_hson_node(clone)) {
        return materialize_projected_value(projected_value_from_hson_node(clone));
    }
    return jsonFromNode(clone);
}

function collapse_redundant_roots(node: HsonNode): HsonNode {
    let current = node;

    while (
        current.$_tag === ROOT_TAG &&
        (!current.$_meta || Object.keys(current.$_meta).length === 0)
    ) {
        const kids = current.$_content ?? [];
        if (kids.length !== 1) return current;

        const only = kids[0];
        if (!is_Node(only) || only.$_tag !== ROOT_TAG) return current;

        current = only;
    }

    return current;
}

/**
 * Recursively convert a HSON node into the public in-memory `JsonValue`.
 *
 * This converter backs `.toJson().value()`. JSON text serialization uses the
 * ordered internal projection above so integer-index property names never
 * cross a lossy JavaScript-object enumeration boundary before emission.
 *
 * Tag-by-tag semantics:
 *
 * - `_hson_root`:
 *   - Must have exactly one child.
 *   - That child is taken as the true data cluster; `_hson_root` itself is not
 *     reflected in the JSON surface.
 *
 * - `_hson_arr`:
 *   - Expects `$_content` to be a list of `_hson_ii` index nodes.
 *   - Each `_hson_ii` is unwrapped and converted; the resulting array preserves
 *     element order and ignores the index metadata.
 *
 * - `_hson_obj`:
 *   - If `$_content` has a single child that is one of:
 *       `_hson_str`, `_hson_val`, `_hson_arr`, `_hson_obj`, `_hson_elem`
 *     then this wrapper is treated as transparent and the child’s JSON
 *     representation is returned directly. This mirrors the “cluster”
 *     behavior in the rest of the system.
 *   - Otherwise:
 *     - Each child is treated as a property node:
 *       - The tag name (`propNode.$_tag`) becomes the object key.
 *       - The first child of that property node is converted recursively
 *         and used as the value.
 *     - Produces a plain `JsonObj` whose keys correspond to these tag names.
 *
 * - `_hson_str` / `_hson_val`:
 *   - Return their single primitive payload directly:
 *     - `_hson_str` → string
 *     - `_hson_val` → number | boolean | null
 *
 * - `_hson_elem`:
 *   - Represents “element cluster” semantics in JSON form.
 *   - Each child in `$_content` is converted recursively.
 *   - The result is wrapped as `{ "_hson_elem": [ ...items ] }`, so that element
 *     mode remains distinguishable at the JSON layer.
 *
 * - `_hson_ii`:
 *   - Index wrapper used inside `_hson_arr`.
 *   - Must contain exactly one child node.
 *   - Unwrapped and converted directly via `jsonFromNode` on that child.
 *
 * - Default branch (standard or user-defined tag, e.g. `"div"`, `"recipe"`):
 *   - Build a property object of the shape:
 *       `{ [tag]: <payload>, $_attrs?, $_meta? }`
 *   - Content:
 *       - No children  → `{ [tag]: { _hson_elem: [] } }`, preserving the
 *         established element-mode VSN projection after empty ordinary nodes
 *         stopped retaining an empty wrapper internally
 *       - One child    → `{ [tag]: jsonFromNode(child) }`
 *       - Multiple children → error (a standard tag is not allowed to have
 *         multiple content clusters at this stage).
 *   - Attributes:
 *       - If `$_attrs` is present and non-empty, it is attached as `$_attrs`
 *         on the same object, merged with any existing `$_attrs`.
 *   - Meta:
 *       - If `$_meta` is present and non-empty, it is attached as `$_meta`
 *         without further filtering; meta is preserved as-is in JSON mode.
 *
 * Safety / guardrails:
 * - Rejects any tag that starts with `_` but is not a known VSN
 *   (`EVERY_VSN`), to avoid leaking unknown control tags into JSON.
 * - For `_hson_root`, `_hson_arr`, `_hson_ii`, `_hson_elem`, and cluster shapes, checks that
 *   structural expectations are met (e.g., `_hson_root` has exactly one child,
 *   `_hson_ii` has exactly one child, etc.).
 *
 * @param node - The HSON node to convert.
 * @returns A `JsonValue` (object, array, or primitive) suitable for
 *   `JSON.stringify`.
 * @throws If the node shape violates HSON invariants or contains unknown
 *   VSN-like tags.
 */
function jsonFromNode(node: HsonNode): JsonValue {

    if (!node || (typeof node.$_tag !== 'string')) {
        console.warn('warning! node is type: ', typeof node);
        _throw_transform_err(`Invalid node or node tag`, 'serialize_json');
    }

        if (node.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(node.$_tag)) {
            _throw_transform_err(`unknown VSN-like tag: <${node.$_tag}>`, 'parse-html');
        }
    
    /* step 1: catch VSNs */

    switch (node.$_tag) {
        case ROOT_TAG: {
            if (!node.$_content || node.$_content.length !== 1) {
               console.error(make_string(node))
                _throw_transform_err('malformed _hson_root node -  must have exactly one child', 'serialize_json');
            }
            // The recursive call now expects the child to be in the NEW format.
            return jsonFromNode(node.$_content[0] as HsonNode);
        }

        case ARR_TAG: {
            let array: JsonValue[] = [];
            if (node.$_content) {
                /*  content of _hson_arr node must be _hson_ii nodes */
                for (const iiNode of node.$_content as HsonNode[]) {
                    if (is_indexed(iiNode)) {
                        array.push(jsonFromNode(iiNode.$_content[0] as HsonNode));
                    } else {
                        _throw_transform_err(`malformed _hson_ii node in _hson_arr`, 'serialize-json');
                    }
                }
            }
            return array;
        }

        case OBJ_TAG: {
            const jsonObj: JsonObj = {};
            if (node.$_content && node.$_content.length === 1) {
                const only = node.$_content[0] as HsonNode;
                // unwrap primitive/array/object/elem wrappers produced by the parser
                if (only.$_tag === STR_TAG || only.$_tag === VAL_TAG || only.$_tag === ARR_TAG || only.$_tag === OBJ_TAG || only.$_tag === ELEM_TAG) {
                    return jsonFromNode(only); // <- avoids calling with a primitive later
                }
            }
            if (node.$_content) {
                for (const propNode of node.$_content as HsonNode[]) {
                    const key = propNode.$_tag;
                    let value: JsonValue = {};
                    if (propNode.$_content && propNode.$_content.length > 0) {
                        const child = propNode.$_content[0];
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
            return node.$_content[0] as Primitive;
        }

        case ELEM_TAG: {
            /* _hson_elem tags are native to HTML and will be carried through the JSON as-is; the only 
                exceptional handling is the contents of _hson_elem tags are not rewrapped in an _hson_obj */
            const elemItems: JsonValue = [];
            for (const itemNode of (node.$_content)) {
                /* recursively convert each item node in the _hson_elem to its JSON equivalent */
                const jsonItem = jsonFromNode(itemNode as HsonNode);
                elemItems.push(jsonItem);
            }
            return { [ELEM_TAG]: elemItems };
        }
        case II_TAG: {
            if (!node.$_content || node.$_content.length !== 1) {
                _throw_transform_err('misconfigured _hson_ii node', 'serialize_json');
            }
            return jsonFromNode(node.$_content[0] as HsonNode);
        }

        default: { /* "standard" tag (e.g. "foo", "kingdom", "html", "p", "span") */

            let tempJson: JsonObj = {};
            if (node.$_content && node.$_content.length === 0) {
                tempJson = { [node.$_tag]: { [ELEM_TAG]: [] } };
            } else if (node.$_content && node.$_content.length === 1) {
                const recursed = jsonFromNode(node.$_content[0] as HsonNode);
                tempJson = { [node.$_tag]: recursed };
            } else if (node.$_content && node.$_content.length > 1) {
                /*  This implies a cluster of values if a standard tag has multiple content VSNs
                    (should be rare or never) */
                _throw_transform_err(`<${node.$_tag}> has multiple content VSN children`, 'serialize_json');
            }

            /* handle $_meta */
            const hasAttrs = node.$_attrs && Object.keys(node.$_attrs).length > 0;
            const hasMeta = node.$_meta && Object.keys(node.$_meta).length > 0;
            const finalJson: JsonObj = tempJson;

            if (hasAttrs) {
                (finalJson as any).$_attrs = {
                    ...(finalJson as any).$_attrs,
                    ...(node.$_attrs as Record<string, unknown>)
                };
            }

            // meta stays as-is
            if (hasMeta) {
                (finalJson as any).$_meta = node.$_meta;
            }
            return finalJson;
        }
    }
}
