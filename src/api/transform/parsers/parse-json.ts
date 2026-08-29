// parse-json.ts

import { is_Primitive, is_string } from "../../../core/value-guards.js";
import { VAL_TAG, STR_TAG, ARR_TAG, OBJ_TAG, II_TAG, ELEM_TAG, ROOT_TAG, HSON_SYS_PREFIX, ATTRS_KEY, META_KEY } from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { HsonMeta, HsonAttrs, HsonNode } from "../../../core/types.js";
import { JsonValue, Primitive } from "../../../core/types.js";
import { assert_invariants } from "../../../core/assert-invariants.js";
import { _snip } from "../utils/sys-utils/snip.utils.js";
import { make_string } from "../../../core/stringify.js";
import { parse_style_string } from "../utils/attrs-utils/parse-style.js";
import { serialize_style } from "../utils/attrs-utils/serialize-style.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { normalize_hson_graph } from "../../../core/normalize-hson-graph.js";
import { assert_user_key_allowed } from "../utils/json-utils/key-prefix-guard.js";
import { is_transform_error } from "../../../core/errors.js";
import {
    is_ordered_projected_object,
    is_ordered_projected_value,
    type OrderedProjectedObject,
    type OrderedProjectedValue,
} from "../../../core/ordered-projected-value.js";
import {
    admit_projected_value,
    ProjectedValueAdmissionError,
} from "../../../core/projected-value-admission.js";
import { projected_value_to_hson_node } from "../../../core/projected-value-graph.js";
import {
    ordered_json_to_runtime_value,
    parse_ordered_json_text,
} from "../utils/json-utils/ordered-json.js";

type JsonInputValue = JsonValue | OrderedProjectedValue;
type JsonInputObject = Record<string, unknown> | OrderedProjectedObject;

function is_json_input_object(value: unknown): value is JsonInputObject {
    return is_ordered_projected_object(value) || is_plain_record(value);
}

function json_input_entries(value: JsonInputObject): readonly (readonly [string, JsonInputValue])[] {
    return is_ordered_projected_object(value)
        ? value.entries
        : Object.entries(value) as readonly (readonly [string, JsonInputValue])[];
}

function json_input_keys(value: JsonInputObject): readonly string[] {
    return json_input_entries(value).map(([key]) => key);
}

function json_input_has(value: JsonInputObject, key: string): boolean {
    return is_ordered_projected_object(value)
        ? value.entries.some(([candidate]) => candidate === key)
        : Object.prototype.hasOwnProperty.call(value, key);
}

function json_input_get(value: JsonInputObject, key: string): JsonInputValue | undefined {
    if (is_ordered_projected_object(value)) {
        return value.entries.find(([candidate]) => candidate === key)?.[1];
    }
    return value[key] as JsonInputValue | undefined;
}

function json_input_plain_record(value: JsonInputObject): Record<string, unknown> {
    if (!is_ordered_projected_object(value)) return value;
    return ordered_json_to_runtime_value(value) as Record<string, unknown>;
}

function describe_json_input(value: unknown): string {
    return make_string(is_ordered_projected_object(value) ? ordered_json_to_runtime_value(value) : value);
}

function semantic_projected_value(value: JsonInputValue): OrderedProjectedValue {
    if (is_ordered_projected_value(value)) return value;
    return admit_projected_value(value);
}

function assert_transform_projected_keys(value: OrderedProjectedValue): void {
    if (Array.isArray(value)) {
        for (const child of value) assert_transform_projected_keys(child);
        return;
    }
    if (!is_ordered_projected_object(value)) return;
    for (const [key, child] of value.entries) {
        assert_user_key_allowed(key, "parse-json");
        assert_transform_projected_keys(child);
    }
}

/**
 * Infer the appropriate Hson VSN tag for a JSON value.
 *
 * Mapping rules:
 * - Arrays → `_hson_arr`
 * - Plain objects → `_hson_obj`
 * - Strings → `_hson_str`
 * - `null`, numbers, booleans → `_hson_val`
 *
 * Anything that does not fit these categories triggers a transform error.
 *
 * This function is used by JSON→Hson transforms to choose the correct
 * structural tag for each JSON value.
 *
 * @param value - Arbitrary JSON value to classify.
 * @returns One of `ARR_TAG`, `OBJ_TAG`, `STR_TAG`, or `VAL_TAG`.
 * @throws If the value cannot be classified.
 */
function getTag(value: JsonInputValue): string {
    // 1) Collections first (so they aren't misclassified as "not string")
    if (Array.isArray(value)) return ARR_TAG;            // _hson_arr
    if (is_json_input_object(value)) return OBJ_TAG;        // _hson_obj

    // 2) Scalars
    if (typeof value === "string") return STR_TAG;       // _hson_str
    if (value === null || typeof value === "number" || typeof value === "boolean") {
        return VAL_TAG;                                   // _hson_val (num|bool|null)
    }

    _throw_transform_err("invalid value provided", "getTag", "???");
}


const JSON_ELEMENT_META_KEYS = new Set<string>([
    ATTRS_KEY,
    META_KEY,
]);

const FORBIDDEN_JSON_VSN = new Set([
    OBJ_TAG, ARR_TAG, II_TAG, STR_TAG, VAL_TAG,
] as string[]); // $_attrs is HTML-source only

function is_plain_record(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function optional_json_record(
    value: unknown,
    field: typeof ATTRS_KEY | typeof META_KEY,
    where: string,
    allowLegacyEmptyArray: boolean,
): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
        if (allowLegacyEmptyArray && value.length === 0) return undefined;
        _throw_transform_err(`${field} must be a plain object when present`, "parse_json", where);
    }
    if (!is_json_input_object(value)) {
        _throw_transform_err(`${field} must be a plain object when present`, "parse_json", where);
    }
    const record = json_input_plain_record(value);
    return Object.keys(record).length === 0 ? undefined : { ...record };
}

/**
 * Return the keys of an object that do not start with `"_-"`.
 *
 * Intended for separating user-facing JSON properties from reserved
 * Hson/VSN metadata, which conventionally use underscore-prefixed keys.
 *
 * @param obj - Object whose keys should be filtered.
 * @returns An array of keys that do not begin with `"_-"`.
 */
function jsonElementTagKey(obj: JsonInputObject): string[] {
    return json_input_keys(obj).filter((key) => {
        if (JSON_ELEMENT_META_KEYS.has(key)) return false;
        if (key.startsWith(HSON_SYS_PREFIX)) return false;
        return true;
    });
}

/**
 * Assert that a JSON object does not use reserved Hson/VSN keys.
 *
 * Reserved keys:
 * - `_hson_obj`, `_hson_arr`, `_hson_ii`, `_hson_str`, `_hson_val`
 *
 * These are reserved for Hson/HTML internal structures and must not
 * appear directly in user-provided JSON. If any such key is found,
 * a transform error is thrown with contextual information.
 *
 * @param obj - The JSON object to validate.
 * @param where - Human-readable context string describing the location
 *                of this object in the overall JSON structure, used
 *                to enrich the error message.
 * @throws If `obj` contains any reserved key listed in `FORBIDDEN_JSON_VSN`.
 * @see FORBIDDEN_JSON_VSN
 * @see _throw_transform_err
 */
function assertNoForbiddenVSNKeysInJSON(obj: JsonInputObject, where: string) {
    for (const k of json_input_keys(obj)) {
        if (FORBIDDEN_JSON_VSN.has(k)) {
            _throw_transform_err(
                `JSON input must not contain "${k}" (reserved for Hson/HTML)`,
                "parse_json",
                `${where}\n${describe_json_input(obj)}`
            );
        }
    }
}

/**
 * Convert a JSON value into an `HsonNode` subtree, using a parent tag
 * to decide which Hson shape to build (`_hson_str`, `_hson_val`, `_hson_arr`, `_hson_obj`,
 * `_hson_elem`, `_hson_root`).
 *
 * Dispatch rules (by `$parentTag`):
 *
 * 1. Primitive branch (`STR_TAG` / `VAL_TAG`)
 *    - `STR_TAG`:
 *      - Requires `srcJson` to be a string, including `""`.
 *      - Returns `<_hson_str>` with `$_content: [string]`.
 *    - `VAL_TAG`:
 *      - Requires `srcJson` to be a non-string primitive
 *        (`number | boolean | null`).
 *      - Returns `<_hson_val>` with `$_content: [primitive]`.
 *
 * 2. Array branch (`ARR_TAG`)
 *    - Requires `srcJson` to be an array.
 *    - For each item:
 *      - Computes the child tag with `getTag(val)`.
 *      - Recursively calls `nodeFromJson(val, childTag)` to get a child node.
 *      - Wraps the child in an `<_hson_ii>` node with `$_meta.index` equal
 *        to the array index.
 *    - Returns `<_hson_arr>` containing the `_hson_ii` children.
 *
 * 3. Object branch (`OBJ_TAG`)
 *    - Requires `srcJson` to be a non-array object.
 *    - Applies one of three mutually exclusive paths:
 *
 *    A) Root form: `{ _hson_root: <payload>, ... }`
 *       - Forbids siblings alongside `_hson_root`.
 *       - Recursively parses `<payload>` via `nodeFromJson`.
 *       - Ensures the `_hson_root` child is a cluster:
 *         - Scalar children (`_hson_str` / `_hson_val`) are wrapped in `<_hson_elem>`.
 *       - Returns `<_hson_root>` containing a single cluster child.
 *
 *    B) Element form: `{ "_hson_elem": [ ... ] }`
 *       - Requires `_hson_elem` value to be an array.
 *       - Each item must be one of:
 *         - `string` → `<_hson_str>` child,
 *         - `number | boolean | null` → `<_hson_val>` child,
 *         - element-object:
 *           `{ tagName: payload, $_attrs?, $_meta? }`
 *           - Rejects reserved VSN keys via
 *             `assertNoForbiddenVSNKeysInJSON`.
 *           - Requires exactly one non-underscore tag key.
 *           - Hoists `$_attrs` and `$_meta` onto the created element node.
 *           - Normalizes `$_attrs.style`, accepting:
 *             - style object → `serialize_style` → `parse_style_string`,
 *             - style string → `parse_style_string`,
 *             - null/undefined → dropped.
 *           - Recursively builds the child subtree from `payload` using
 *             `nodeFromJson(...)`.
 *       - Returns a single `<_hson_elem>` node with these children.
 *
 *    C) Generic object form (plain JSON object)
 *       - Forbids reserved VSN keys via
 *         `assertNoForbiddenVSNKeysInJSON`.
 *       - For each own key:
 *         - Builds a value node:
 *           - `string` → `<_hson_str>`,
 *           - `number | boolean | null` → `<_hson_val>`,
 *           - array → recurse with parent `_hson_arr`,
 *           - object → recurse with parent `_hson_obj`.
 *         - Wraps non-cluster children in an `<_hson_obj>` to enforce JSON-mode
 *           “object cluster” semantics.
 *         - Wraps that in a property node `<key>` whose `$_content` is the
 *           cluster payload.
 *       - Returns a single `<_hson_obj>` node containing all property nodes.
 *
 * Errors:
 * - Throws via `_throw_transform_err` when:
 *   - `srcJson` type does not match the expected parent tag.
 *   - `_hson_root` objects have illegal siblings.
 *   - `_hson_elem` is not an array or has invalid items.
 *   - A generic object contains reserved VSN keys.
 *   - A value is not representable as a supported Hson shape.
 *
 * @param srcJson - The JSON value to convert (already parsed).
 * @param parentTag - The Hson tag that dictates how `srcJson` is interpreted
 *   (`STR_TAG`, `VAL_TAG`, `ARR_TAG`, `OBJ_TAG`, etc).
 * @returns An object containing the constructed `node` subtree.
 * @see parse_json
 * @see getTag
 * @see assertNoForbiddenVSNKeysInJSON
 */
export function nodeFromJson(
    srcJson: JsonInputValue,
    parentTag: string
): { node: HsonNode } {

    // ---- 0) Primitive branch (strings → _hson_str, others → _hson_val) ----
    if (parentTag === STR_TAG || parentTag === VAL_TAG) {
        // preserve empty-string as a real scalar (_hson_str([""]))
        if (parentTag === STR_TAG) {
            if (typeof srcJson !== "string") {
                _throw_transform_err(`expected string for ${STR_TAG}, got ${typeof srcJson}`, "nodeFromJson.primitive");
            }
            return { node: projected_value_to_hson_node(srcJson) };
        } else { // VAL_TAG
            if (!is_Primitive(srcJson)) {
                _throw_transform_err(`expected number|boolean|null for ${VAL_TAG}, got ${typeof srcJson}`, "nodeFromJson.primitive");
            }
            return { node: projected_value_to_hson_node(srcJson) };
        }
    }

    // ---- 1) Array branch (_hson_arr → _hson_ii[index]) ----
    if (parentTag === ARR_TAG) {
        if (!Array.isArray(srcJson)) {
            _throw_transform_err("array expected for ARR_TAG parent", "parse_json", make_string(srcJson));
        }
        const semantic = semantic_projected_value(srcJson);
        assert_transform_projected_keys(semantic);
        return { node: projected_value_to_hson_node(semantic) };
    }

    // ---- 2) Object branch (three mutually exclusive shapes) ----
    if (parentTag === OBJ_TAG) {
        if (!is_json_input_object(srcJson)) {
            _throw_transform_err("object expected for OBJ_TAG parent", "parse_json", describe_json_input(srcJson));
        }
        const obj = srcJson;
        // A) HARD-CODED ROOT: { _hson_root: <cluster-or-primitive>, $_meta?: ... }

        if (json_input_has(obj, ROOT_TAG)) {
            const siblings = json_input_keys(obj).filter((key) => key !== ROOT_TAG && key !== META_KEY);
            if (siblings.length > 0) {
                _throw_transform_err(
                    "'_hson_root' object may not have ordinary siblings",
                    "parse_json",
                    describe_json_input(obj)
                );
            }
            const rootMeta = json_input_has(obj, META_KEY)
                ? optional_json_record(
                    json_input_get(obj, META_KEY),
                    META_KEY,
                    `at ${ROOT_TAG}`,
                    false,
                ) as HsonMeta | undefined
                : undefined;
            // Parse the root payload
            const rootPayload = json_input_get(obj, ROOT_TAG);
            if (rootPayload === undefined) {
                // Empty _hson_root (allowed) → no children
                return {
                    node: CREATE_NODE({
                        $_tag: ROOT_TAG,
                        $_meta: rootMeta,
                        $_content: [],
                    }),
                };
            }
            const childTag = getTag(rootPayload);
            const child = nodeFromJson(rootPayload, childTag).node;

            // Enforce: _hson_root child must be a cluster (_hson_obj|_hson_arr|_hson_elem). If scalar, coerce to _hson_elem wrapper.
            const isScalar = (child.$_tag === STR_TAG || child.$_tag === VAL_TAG);
            const clusterChild = isScalar
                ? CREATE_NODE({ $_tag: ELEM_TAG, $_content: [child] })
                : child;

            return {
                node: CREATE_NODE({
                    $_tag: ROOT_TAG,
                    $_meta: rootMeta,
                    $_content: [clusterChild],
                }),
            };
        }

        // B) ELEMENT HANDLING { _hson_elem: [...] } 
        if (json_input_has(obj, ELEM_TAG)) {
            const list = json_input_get(obj, ELEM_TAG);
            if (!Array.isArray(list)) {
                _throw_transform_err("'_hson_elem' must contain an array", "parse_json", make_string(list));
            }

            const children: HsonNode[] = (list as JsonInputValue[]).map((val, ix) => {
                // string → _hson_str, number|boolean|null → _hson_val
                if (typeof val === "string") {
                    return CREATE_NODE({ $_tag: STR_TAG, $_content: [val] });
                }
                if (val === null || typeof val === "number" || typeof val === "boolean") {
                    return CREATE_NODE({ $_tag: VAL_TAG, $_content: [val as Primitive] });
                }

                // object → element-object (allow $_attrs/$_meta; preserve them)
                if (is_json_input_object(val)) {
                    const elObj = val;

                    // guard against raw VSN misuse
                    assertNoForbiddenVSNKeysInJSON(elObj, `"_hson_elem"[${ix}]`);

                    // Exactly one non-underscore tag key required
                    const tagKeys = jsonElementTagKey(elObj);
                    if (tagKeys.length !== 1) {
                        _throw_transform_err("element-object may not have multiple tags??", "parse_json", describe_json_input(elObj));
                    }

                    const tagName = tagKeys[0];

                    // hoist attributes/meta if present
                    const hoistedAttrs = json_input_has(elObj, ATTRS_KEY)
                        ? optional_json_record(
                            json_input_get(elObj, ATTRS_KEY),
                            ATTRS_KEY,
                            `at "_hson_elem"[${ix}]`,
                            true,
                        ) as HsonAttrs | undefined
                        : undefined;
                    const hoistedMeta = json_input_has(elObj, META_KEY)
                        ? optional_json_record(
                            json_input_get(elObj, META_KEY),
                            META_KEY,
                            `at "_hson_elem"[${ix}]`,
                            true,
                        ) as HsonMeta | undefined
                        : undefined;

                    if (hoistedAttrs && Object.prototype.hasOwnProperty.call(hoistedAttrs, "style")) {
                        const sv = hoistedAttrs.style;

                        if (sv && typeof sv === "object" && !Array.isArray(sv)) {
                            // JSON gave a style object ⇒ canonicalize 
                            const css = serialize_style(sv as Record<string, string>);      // kebab/trim/sort
                            hoistedAttrs.style = parse_style_string(css);        // lower→camel done here
                        } else if (typeof sv === "string") {
                            // JSON gave style as text ⇒ parse to canonical object
                            hoistedAttrs.style = parse_style_string(sv);
                        } else {
                            // null/undefined ⇒ drop
                            delete hoistedAttrs.style;
                        }
                    }

                    // Build the tag’s child (0..1) from the tag payload (scalar or cluster)
                    const rawChildren = json_input_get(elObj, tagName);
                    let tagKids: HsonNode[] = [];
                    // The established JSON element projection uses an empty
                    // string for an ordinary empty element. In this explicit
                    // element context it is structural absence, not an object
                    // scalar relationship.
                    if (rawChildren !== undefined && rawChildren !== "") {
                        const kidTag = getTag(rawChildren);
                        const kidNode = nodeFromJson(rawChildren, kidTag).node;
                        tagKids = [kidNode];
                    }

                    const elemNode = CREATE_NODE({ $_tag: tagName, $_content: tagKids });
                    if (hoistedAttrs && Object.keys(hoistedAttrs).length) elemNode.$_attrs = hoistedAttrs;  // ← preserve
                    if (hoistedMeta && Object.keys(hoistedMeta).length) elemNode.$_meta = { ...elemNode.$_meta, ...hoistedMeta };

                    return elemNode;
                }

                _throw_transform_err(
                    `invalid item in "_hson_elem"[${ix}] (must be string|number|boolean/null or element-object)`,
                    "parse_json",
                    describe_json_input(val)
                );
            });

            return { node: CREATE_NODE({ $_tag: ELEM_TAG, $_content: children }) };

        }

        // C) GENERIC OBJECT HANDLING → _hson_obj
        assertNoForbiddenVSNKeysInJSON(obj, "[generic object check, parseJSON]");
        const semantic = semantic_projected_value(srcJson);
        assert_transform_projected_keys(semantic);
        return { node: projected_value_to_hson_node(semantic) };
    }

    // ---- Fallback (should be unreachable if callers set parentTag correctly) ----
    _throw_transform_err(`unhandled parentTag ${parentTag}`, "nodeFromJson.dispatch");
}

/**
 * Parse JSON into a rooted `HsonNode` tree.
 *
 * Input handling:
 * - If `input` is a string, it is parsed with `JSON.parse`. Any parse
 *   error is wrapped and rethrown via `_throw_transform_err`.
 * - The parsed or supplied value is detached recursively before conversion.
 *   Caller records and arrays are never normalized in place or retained by
 *   the canonical graph.
 * - Cyclic and non-JSON object values reject deterministically.
 *
 * Explicit `_hson_root` handling:
 * - A top-level `{ "_hson_root": <payload>, "$_meta"?: ... }` is constructed
 *   as a root node rather than unwrapped.
 * - Empty `$_meta` is normalized away; populated or malformed root metadata
 *   reaches canonical validation and rejects.
 *
 * Conversion:
 * - Delegates to `nodeFromJson(parsed, getTag(parsed))`
 *   to build the main Hson subtree.
 * - Wraps the resulting node in a `_hson_root` wrapper:
 *   - `$_tag: ROOT_TAG`
 *   - `$_content: [node]`
 * - Runs `assert_invariants` on the final root to ensure structural
 *   correctness.
 *
 * @param input - JSON string or already-parsed `JsonValue`.
 * @returns A `_hson_root`-wrapped `HsonNode` representing the JSON payload.
 * @throws If JSON parsing fails or invariants are violated.
 * @see nodeFromJson
 * @see getTag
 * @see assert_invariants
 */
export function parse_json(input: string | JsonValue): HsonNode {
    let parsed: JsonInputValue;
    if (typeof input === "string") {
        try {
            parsed = parse_ordered_json_text(input);
        } catch (e) {
            if (is_transform_error(e)) throw e;
            _throw_transform_err(`invalid JSON input ${make_string(input)}`, "parse-json", String(e));
        }
    } else {
        // Runtime-value admission retains its established structured failures
        // (notably hson.number-admission / HSON_NUMBER_NONFINITE). Only JSON
        // text syntax failures belong to the parse-json wrapper above.
        try {
            parsed = admit_projected_value(input);
        } catch (error) {
            if (error instanceof ProjectedValueAdmissionError) {
                if (error.code === "NONFINITE_NUMBER" && is_transform_error(error.cause)) {
                    throw error.cause;
                }
                _throw_transform_err(
                    error.message,
                    "parse_json",
                    undefined,
                    error,
                    {
                        code: `PROJECTED_VALUE_${error.code}`,
                        path: JSON.stringify(error.path),
                    },
                );
            }
            throw error;
        }
    }
    const { node } = nodeFromJson(parsed, getTag(parsed));
    const root = node.$_tag === ROOT_TAG
        ? node
        : CREATE_NODE({
            $_tag: ROOT_TAG,
            $_content: [node],
        });
    const normalized = normalize_hson_graph(root, "parse_json");
    assert_invariants(normalized, "parse_json");
    return normalized;
}
