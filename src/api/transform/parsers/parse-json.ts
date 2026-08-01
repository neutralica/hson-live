// parse-json.ts

import { is_Primitive, is_string } from "../../../core/value-guards.js";
import { VAL_TAG, STR_TAG, ARR_TAG, OBJ_TAG, II_TAG, ELEM_TAG, ROOT_TAG, HSON_SYS_PREFIX, ATTRS_KEY, META_KEY } from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { HSON_META_INDEX } from "../../../core/constants.js";
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
import { hsonNumber } from "../../../core/hson-number.js";

/**
 * Infer the appropriate HSON VSN tag for a JSON value.
 *
 * Mapping rules:
 * - Arrays → `_hson_arr`
 * - Plain objects → `_hson_obj`
 * - Strings → `_hson_str`
 * - `null`, numbers, booleans → `_hson_val`
 *
 * Anything that does not fit these categories triggers a transform error.
 *
 * This function is used by JSON→HSON transforms to choose the correct
 * structural tag for each JSON value.
 *
 * @param value - Arbitrary JSON value to classify.
 * @returns One of `ARR_TAG`, `OBJ_TAG`, `STR_TAG`, or `VAL_TAG`.
 * @throws If the value cannot be classified.
 */
function getTag(value: JsonValue): string {
    // 1) Collections first (so they aren't misclassified as "not string")
    if (Array.isArray(value)) return ARR_TAG;            // _hson_arr
    if (is_plain_record(value)) return OBJ_TAG;        // _hson_obj

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

/**
 * Detach the complete parsed-value input before normalization can rewrite it.
 *
 * Shared acyclic references are copied by value rather than preserving caller
 * identity. Active references are rejected so cycles fail at a deterministic
 * JSON-ingress boundary instead of overflowing recursive conversion.
 */
function detach_json_input(input: unknown): JsonValue {
    const active = new WeakMap<object, string>();

    const visit = (value: unknown, path: string): unknown => {
        if (value === undefined || value === null
            || typeof value === "string"
            || typeof value === "boolean") {
            return value;
        }
        if (typeof value === "number") return hsonNumber(value);

        if (typeof value !== "object") {
            _throw_transform_err(
                `unsupported parsed JSON value at ${path}`,
                "parse_json",
                `received ${typeof value}`,
            );
        }

        const origin = active.get(value);
        if (origin !== undefined) {
            _throw_transform_err(
                `cycle detected in parsed JSON input at ${path}`,
                "parse_json",
                `reference returns to ${origin}`,
            );
        }

        active.set(value, path);
        if (Array.isArray(value)) {
            const detached = value.map((item, index) => visit(item, `${path}[${index}]`));
            active.delete(value);
            return detached;
        }
        if (!is_plain_record(value)) {
            active.delete(value);
            _throw_transform_err(
                `parsed JSON object at ${path} must be a plain object`,
                "parse_json",
            );
        }

        const detached: Record<string, unknown> = Object.create(null);
        for (const key of Object.keys(value)) {
            detached[key] = visit(value[key], `${path}.${key}`);
        }
        active.delete(value);
        return detached;
    };

    const detached = visit(input, "$");
    if (detached === undefined) {
        _throw_transform_err("invalid value provided", "parse_json", "top-level undefined");
    }
    return detached as JsonValue;
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
    if (!is_plain_record(value)) {
        _throw_transform_err(`${field} must be a plain object when present`, "parse_json", where);
    }
    return Object.keys(value).length === 0 ? undefined : { ...value };
}

/**
 * Return the keys of an object that do not start with `"_-"`.
 *
 * Intended for separating user-facing JSON properties from reserved
 * HSON/VSN metadata, which conventionally use underscore-prefixed keys.
 *
 * @param obj - Object whose keys should be filtered.
 * @returns An array of keys that do not begin with `"_-"`.
 */
function jsonElementTagKey(obj: Record<string, unknown>): string[] {
    return Object.keys(obj).filter((key) => {
        if (JSON_ELEMENT_META_KEYS.has(key)) return false;
        if (key.startsWith(HSON_SYS_PREFIX)) return false;
        return true;
    });
}

/**
 * Assert that a JSON object does not use reserved HSON/VSN keys.
 *
 * Reserved keys:
 * - `_hson_obj`, `_hson_arr`, `_hson_ii`, `_hson_str`, `_hson_val`
 *
 * These are reserved for HSON/HTML internal structures and must not
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
function assertNoForbiddenVSNKeysInJSON(obj: Record<string, unknown>, where: string) {
    for (const k of Object.keys(obj)) {
        if (FORBIDDEN_JSON_VSN.has(k)) {
            _throw_transform_err(
                `JSON input must not contain "${k}" (reserved for HSON/HTML)`,
                "parse_json",
                `${where}\n${make_string(obj)}`
            );
        }
    }
}

/**
 * Convert a JSON value into an `HsonNode` subtree, using a parent tag
 * to decide which HSON shape to build (`_hson_str`, `_hson_val`, `_hson_arr`, `_hson_obj`,
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
 *   - A value is not representable as a supported HSON shape.
 *
 * @param srcJson - The JSON value to convert (already parsed).
 * @param parentTag - The HSON tag that dictates how `srcJson` is interpreted
 *   (`STR_TAG`, `VAL_TAG`, `ARR_TAG`, `OBJ_TAG`, etc).
 * @returns An object containing the constructed `node` subtree.
 * @see parse_json
 * @see getTag
 * @see assertNoForbiddenVSNKeysInJSON
 */
export function nodeFromJson(
    srcJson: JsonValue,
    parentTag: string
): { node: HsonNode } {

    // ---- 0) Primitive branch (strings → _hson_str, others → _hson_val) ----
    if (parentTag === STR_TAG || parentTag === VAL_TAG) {
        // preserve empty-string as a real scalar (_hson_str([""]))
        if (parentTag === STR_TAG) {
            if (!is_string(srcJson)) {
                _throw_transform_err(`expected string for ${STR_TAG}, got ${typeof srcJson}`, "nodeFromJson.primitive");
            }
            return {
                node: CREATE_NODE({
                    $_tag: STR_TAG,
                    $_content: [srcJson] // "" included
                })
            };
        } else { // VAL_TAG
            if (!is_Primitive(srcJson)) {
                _throw_transform_err(`expected number|boolean|null for ${VAL_TAG}, got ${typeof srcJson}`, "nodeFromJson.primitive");
            }
            const admitted = typeof srcJson === "number" ? hsonNumber(srcJson) : srcJson;
            return {
                node: CREATE_NODE({
                    $_tag: VAL_TAG,
                    $_content: [admitted] // null/admitted-number/boolean
                })
            };
        }
    }

    // ---- 1) Array branch (_hson_arr → _hson_ii[index]) ----
    if (parentTag === ARR_TAG) {
        if (!Array.isArray(srcJson)) {
            _throw_transform_err("array expected for ARR_TAG parent", "parse_json", make_string(srcJson));
        }
        const items = (srcJson as JsonValue[]).map((val, ix) => {
            const childTag = getTag(val);
            const child = nodeFromJson(val, childTag).node;
            return CREATE_NODE({
                $_tag: II_TAG,
                $_meta: { [HSON_META_INDEX]: String(ix) },
                $_content: [child]
            });
        });
        return { node: CREATE_NODE({ $_tag: ARR_TAG, $_content: items }) };
    }

    // ---- 2) Object branch (three mutually exclusive shapes) ----
    if (parentTag === OBJ_TAG) {
        if (!srcJson || typeof srcJson !== "object" || Array.isArray(srcJson)) {
            _throw_transform_err("object expected for OBJ_TAG parent", "parse_json", make_string(srcJson));
        }
        const obj = srcJson as Record<string, unknown>;
        // A) HARD-CODED ROOT: { _hson_root: <cluster-or-primitive>, $_meta?: ... }

        if (Object.prototype.hasOwnProperty.call(obj, ROOT_TAG)) {
            const siblings = Object.keys(obj).filter((key) => key !== ROOT_TAG && key !== META_KEY);
            if (siblings.length > 0) {
                _throw_transform_err(
                    "'_hson_root' object may not have ordinary siblings",
                    "parse_json",
                    make_string(obj)
                );
            }
            const rootMeta = Object.prototype.hasOwnProperty.call(obj, META_KEY)
                ? optional_json_record(
                    obj[META_KEY],
                    META_KEY,
                    `at ${ROOT_TAG}`,
                    false,
                ) as HsonMeta | undefined
                : undefined;
            // Parse the root payload
            const rootPayload = obj[ROOT_TAG] as JsonValue;
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
        if (Object.prototype.hasOwnProperty.call(obj, ELEM_TAG)) {
            const list = obj[ELEM_TAG];
            if (!Array.isArray(list)) {
                _throw_transform_err("'_hson_elem' must contain an array", "parse_json", make_string(list));
            }

            const children: HsonNode[] = (list as JsonValue[]).map((val, ix) => {
                // string → _hson_str, number|boolean|null → _hson_val
                if (is_string(val)) {
                    return CREATE_NODE({ $_tag: STR_TAG, $_content: [val] });
                }
                if (is_Primitive(val)) {
                    return CREATE_NODE({ $_tag: VAL_TAG, $_content: [val as Primitive] });
                }

                // object → element-object (allow $_attrs/$_meta; preserve them)
                if (val && typeof val === "object" && !Array.isArray(val)) {
                    const elObj = val as Record<string, unknown>;

                    // guard against raw VSN misuse
                    assertNoForbiddenVSNKeysInJSON(elObj, `"_hson_elem"[${ix}]`);

                    // Exactly one non-underscore tag key required
                    const tagKeys = jsonElementTagKey(elObj);
                    if (tagKeys.length !== 1) {
                        _throw_transform_err("element-object may not have multiple tags??", "parse_json", make_string(elObj));
                    }

                    const tagName = tagKeys[0];

                    // hoist attributes/meta if present
                    const hoistedAttrs = Object.prototype.hasOwnProperty.call(elObj, ATTRS_KEY)
                        ? optional_json_record(
                            elObj[ATTRS_KEY],
                            ATTRS_KEY,
                            `at "_hson_elem"[${ix}]`,
                            true,
                        ) as HsonAttrs | undefined
                        : undefined;
                    const hoistedMeta = Object.prototype.hasOwnProperty.call(elObj, META_KEY)
                        ? optional_json_record(
                            elObj[META_KEY],
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
                    const rawChildren = elObj[tagName] as JsonValue;
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
                    make_string(val)
                );
            });

            return { node: CREATE_NODE({ $_tag: ELEM_TAG, $_content: children }) };

        }

        // C) GENERIC OBJECT HANDLING → _hson_obj
        assertNoForbiddenVSNKeysInJSON(obj, "[generic object check, parseJSON]");
        const propKeys = Object.keys(obj);

        const propertyNodes: HsonNode[] = propKeys.map((key) => {
            assert_user_key_allowed(key, "parse-json");
            const raw = obj[key] as JsonValue;

            // build a child node for the property value WITHOUT collapsing "".
            let child: HsonNode;

            if (typeof raw === "string") {
                // strings (including "") → _hson_str(["..."])
                child = CREATE_NODE({
                    $_tag: STR_TAG,
                    $_content: [raw] // "" preserved
                });
            } else if (
                typeof raw === "number" ||
                typeof raw === "boolean" ||
                raw === null
            ) {
                // numbers/booleans/null → _hson_val([...])
                child = CREATE_NODE({
                    $_tag: VAL_TAG,
                    $_content: [raw]
                });
            } else if (Array.isArray(raw)) {
                // arrays recurse under _hson_arr
                child = nodeFromJson(raw, ARR_TAG).node;
            } else if (raw && typeof raw === "object") {
                // objects recurse under _hson_obj
                child = nodeFromJson(raw, OBJ_TAG).node;
            } else {
                _throw_transform_err(`unsupported JSON value for key "${key}"`, "nodeFromJson.object.value");
            }

            // JSON-mode property ⇒ inner _hson_obj wrapper unless the child is already a cluster
            const payload =
                (child.$_tag === OBJ_TAG || child.$_tag === ARR_TAG)
                    ? [child]                                    // passthrough single cluster
                    : [CREATE_NODE({ $_tag: OBJ_TAG, $_content: [child] })]; // wrap leaf in _hson_obj

            return CREATE_NODE({
                $_tag: key,
                $_content: payload
            });
        });

        return {
            node: CREATE_NODE({
                $_tag: OBJ_TAG,
                $_content: propertyNodes
            })
        };
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
 *   to build the main HSON subtree.
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
    let source: unknown;
    try {
        source = typeof input === "string" ? JSON.parse(input) : input;
    } catch (e) {
        _throw_transform_err(`invalid JSON input ${make_string(input)}`, "parse-json", String(e));
    }
    const parsed = detach_json_input(source);
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
