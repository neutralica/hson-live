// parse-json.transform.hson.ts

import { is_Primitive, is_Object, is_string } from "../../utils/cote-utils/guards.core";
import { VAL_TAG, STR_TAG, ARR_TAG, OBJ_TAG,  II_TAG, ELEM_TAG, ROOT_TAG } from "../../consts/constants";
import { CREATE_NODE } from "../../consts/factories";
import { _DATA_INDEX, _META_DATA_PREFIX } from "../../consts/constants";
import { HsonMeta,  HsonAttrs, HsonNode } from "../../types/node.types";
import { JsonObj, JsonValue, Primitive } from "../../types/core.types";
import { assert_invariants } from "../../diagnostics/assert-invariants.test";
import { _snip } from "../../utils/sys-utils/snip.utils";
import { make_string } from "../../utils/primitive-utils/make-string.nodes.utils";
import { parse_style_string } from "../../utils/attrs-utils/parse-style";
import { serialize_style } from "../../utils/attrs-utils/serialize-style";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";

/**
 * Infer the appropriate HSON VSN tag for a JSON value.
 *
 * Mapping rules:
 * - Arrays → `_arr`
 * - Plain objects → `_obj`
 * - Strings → `_str`
 * - `null`, numbers, booleans → `_val`
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
    if (Array.isArray(value)) return ARR_TAG;            // _arr
    if (is_Object(value)) return OBJ_TAG;              // _obj

    // 2) Scalars
    if (typeof value === 'string') return STR_TAG;       // _str
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        return VAL_TAG;                                   // _val (num|bool|null)
    }

    _throw_transform_err('invalid value provided', 'getTag', '???');
}



const FORBIDDEN_JSON_VSN = new Set([
    '_obj', '_arr', '_ii', '_str', '_val',
]); // _attrs is HTML-source only

/**
 * Return the keys of an object that do not start with `"_"`.
 *
 * Intended for separating user-facing JSON properties from reserved
 * HSON/VSN metadata, which conventionally use underscore-prefixed keys.
 *
 * @param obj - Object whose keys should be filtered.
 * @returns An array of keys that do not begin with `"_"`.
 */
function nonUnderscoreKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj).filter(k => !k.startsWith('_'));
}

/**
 * Assert that a JSON object does not use reserved HSON/VSN keys.
 *
 * Reserved keys:
 * - `_obj`, `_arr`, `_ii`, `_str`, `_val`
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
                'parse_json',
                `${where}\n${make_string(obj)}`
            );
        }
    }
}

/**
 * Convert a JSON value into an `HsonNode` subtree, using a parent tag
 * to decide which HSON shape to build (`_str`, `_val`, `_arr`, `_obj`,
 * `_elem`, `_root`).
 *
 * Dispatch rules (by `$parentTag`):
 *
 * 1. Primitive branch (`STR_TAG` / `VAL_TAG`)
 *    - `STR_TAG`:
 *      - Requires `srcJson` to be a string, including `""`.
 *      - Returns `<_str>` with `_content: [string]`.
 *    - `VAL_TAG`:
 *      - Requires `srcJson` to be a non-string primitive
 *        (`number | boolean | null`).
 *      - Returns `<_val>` with `_content: [primitive]`.
 *
 * 2. Array branch (`ARR_TAG`)
 *    - Requires `srcJson` to be an array.
 *    - For each item:
 *      - Computes the child tag with `getTag(val)`.
 *      - Recursively calls `nodeFromJson(val, childTag)` to get a child node.
 *      - Wraps the child in an `<_ii>` node with `_meta.data-_index` equal
 *        to the array index.
 *    - Returns `<_arr>` containing the `_ii` children.
 *
 * 3. Object branch (`OBJ_TAG`)
 *    - Requires `srcJson` to be a non-array object.
 *    - Applies one of three mutually exclusive paths:
 *
 *    A) Root form: `{ "_root": <payload>, ... }`
 *       - Forbids non-underscore siblings alongside `_root`.
 *       - Recursively parses `<payload>` via `nodeFromJson`.
 *       - Ensures the `_root` child is a cluster:
 *         - Scalar children (`_str` / `_val`) are wrapped in `<_elem>`.
 *       - Returns `<_root>` containing a single cluster child.
 *
 *    B) Element form: `{ "_elem": [ ... ] }`
 *       - Requires `_elem` value to be an array.
 *       - Each item must be one of:
 *         - `string` → `<_str>` child,
 *         - `number | boolean | null` → `<_val>` child,
 *         - element-object:
 *           `{ tagName: payload, _attrs?, _meta? }`
 *           - Rejects reserved VSN keys via
 *             `assertNoForbiddenVSNKeysInJSON`.
 *           - Requires exactly one non-underscore tag key.
 *           - Hoists `_attrs` and `_meta` onto the created element node.
 *           - Normalizes `_attrs.style`, accepting:
 *             - style object → `serialize_style` → `parse_style_string`,
 *             - style string → `parse_style_string`,
 *             - null/undefined → dropped.
 *           - Recursively builds the child subtree from `payload` using
 *             `nodeFromJson(...)`.
 *       - Returns a single `<_elem>` node with these children.
 *
 *    C) Generic object form (plain JSON object)
 *       - Forbids reserved VSN keys via
 *         `assertNoForbiddenVSNKeysInJSON`.
 *       - For each own key:
 *         - Builds a value node:
 *           - `string` → `<_str>`,
 *           - `number | boolean | null` → `<_val>`,
 *           - array → recurse with parent `_arr`,
 *           - object → recurse with parent `_obj`.
 *         - Wraps non-cluster children in an `<_obj>` to enforce JSON-mode
 *           “object cluster” semantics.
 *         - Wraps that in a property node `<key>` whose `_content` is the
 *           cluster payload.
 *       - Returns a single `<_obj>` node containing all property nodes.
 *
 * Errors:
 * - Throws via `_throw_transform_err` when:
 *   - `srcJson` type does not match the expected parent tag.
 *   - `_root` objects have illegal siblings.
 *   - `_elem` is not an array or has invalid items.
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

    // ---- 0) Primitive branch (strings → _str, others → _val) ----
    if (parentTag === STR_TAG || parentTag === VAL_TAG) {
        // preserve empty-string as a real scalar (_str([""]))
        if (parentTag === STR_TAG) {
            if (!is_string(srcJson)) {
                _throw_transform_err(`expected string for ${STR_TAG}, got ${typeof srcJson}`, 'nodeFromJson.primitive');
            }
            return {
                node: CREATE_NODE({
                    _tag: STR_TAG,
                    _meta: {},
                    _content: [srcJson] // "" included
                })
            };
        } else { // VAL_TAG
            if (!is_Primitive(srcJson)) {
                _throw_transform_err(`expected number|boolean|null for ${VAL_TAG}, got ${typeof srcJson}`, 'nodeFromJson.primitive');
            }
            return {
                node: CREATE_NODE({
                    _tag: VAL_TAG,
                    _meta: {},
                    _content: [srcJson] // null/number/boolean
                })
            };
        }
    }

    // ---- 1) Array branch (_arr → _ii[data-_index]) ----
    if (parentTag === ARR_TAG) {
        if (!Array.isArray(srcJson)) {
            _throw_transform_err('array expected for ARR_TAG parent', 'parse_json', make_string(srcJson));
        }
        const items = (srcJson as JsonValue[]).map((val, ix) => {
            const childTag = getTag(val);
            const child = nodeFromJson(val, childTag).node;
            return CREATE_NODE({
                _tag: II_TAG,
                _meta: { 'data-_index': String(ix) },
                _content: [child]
            });
        });
        return { node: CREATE_NODE({ _tag: ARR_TAG, _content: items }) };
    }

    // ---- 2) Object branch (three mutually exclusive shapes) ----
    if (parentTag === OBJ_TAG) {
        if (!srcJson || typeof srcJson !== 'object' || Array.isArray(srcJson)) {
            _throw_transform_err('object expected for OBJ_TAG parent', 'parse_json', make_string(srcJson));
        }
        const obj = srcJson as Record<string, unknown>;

        // A) HARD-CODED ROOT: { _root: <cluster-or-primitive> } (exclusive)
        if (Object.prototype.hasOwnProperty.call(obj, ROOT_TAG)) {
            // No other non-underscore siblings allowed
            const nonUS = nonUnderscoreKeys(obj);
            if (!(nonUS.length === 0 || (nonUS.length === 1 && nonUS[0] === ROOT_TAG))) {
                _throw_transform_err('"_root" object must not have non-underscore siblings', 'parse_json', make_string(obj));
            }
            // Parse the root payload
            const rootPayload = obj[ROOT_TAG] as JsonValue;
            if (rootPayload === undefined) {
                // Empty _root (allowed) → no children
                return { node: CREATE_NODE({ _tag: ROOT_TAG, _content: [] }) };
            }
            const childTag = getTag(rootPayload);
            const child = nodeFromJson(rootPayload, childTag).node;

            // Enforce: _root child must be a cluster (_obj|_arr|_elem). If scalar, coerce to _elem wrapper.
            const isScalar = (child._tag === STR_TAG || child._tag === VAL_TAG);
            const clusterChild = isScalar
                ? CREATE_NODE({ _tag: ELEM_TAG, _content: [child] })
                : child;

            return { node: CREATE_NODE({ _tag: ROOT_TAG, _content: [clusterChild] }) };
        }

        // B) ELEMENT HANDLING { _elem: [...] } 
        if (Object.prototype.hasOwnProperty.call(obj, ELEM_TAG)) {
            const list = obj[ELEM_TAG];
            if (!Array.isArray(list)) {
                _throw_transform_err('"_elem" must contain an array', 'parse_json', make_string(list));
            }

            const children: HsonNode[] = (list as JsonValue[]).map((val, ix) => {
                // string → _str, number|boolean|null → _val
                if (is_string(val)) {
                    return CREATE_NODE({ _tag: STR_TAG, _meta: {}, _content: [val] });
                }
                if (is_Primitive(val)) {
                    return CREATE_NODE({ _tag: VAL_TAG, _meta: {}, _content: [val as Primitive] });
                }

                // object → element-object (allow _attrs/_meta; preserve them)
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const elObj = val as Record<string, unknown>;

                    // guard against raw VSN misuse
                    assertNoForbiddenVSNKeysInJSON(elObj, `"_elem"[${ix}]`);

                    // Exactly one non-underscore tag key required
                    const tagKeys = nonUnderscoreKeys(elObj);
                    if (tagKeys.length !== 1) {
                        _throw_transform_err('element-object must have exactly one tag key', 'parse_json', make_string(elObj));
                    }

                    const tagName = tagKeys[0];

                    // hoist attributes/meta if present
                    const maybeAttrs = elObj['_attrs'];
                    const maybeMeta = elObj['_meta'];
                    const hoistedAttrs = (maybeAttrs && typeof maybeAttrs === 'object' && !Array.isArray(maybeAttrs))
                        ? (maybeAttrs as HsonAttrs)
                        : undefined;
                    const hoistedMeta = (maybeMeta && typeof maybeMeta === 'object' && !Array.isArray(maybeMeta))
                        ? (maybeMeta as HsonMeta)
                        : undefined;

                    if (hoistedAttrs && Object.prototype.hasOwnProperty.call(hoistedAttrs, "style")) {
                        const sv = (hoistedAttrs as any).style;

                        if (sv && typeof sv === "object" && !Array.isArray(sv)) {
                            // JSON gave a style object ⇒ canonicalize 
                            const css = serialize_style(sv as Record<string, string>);      // kebab/trim/sort
                            (hoistedAttrs as any).style = parse_style_string(css);        // lower→camel done here
                        } else if (typeof sv === "string") {
                            // JSON gave style as text ⇒ parse to canonical object
                            (hoistedAttrs as any).style = parse_style_string(sv);
                        } else {
                            // null/undefined ⇒ drop
                            delete (hoistedAttrs as any).style;
                        }
                    }

                    // Build the tag’s child (0..1) from the tag payload (scalar or cluster)
                    const rawChildren = elObj[tagName] as JsonValue;
                    let tagKids: HsonNode[] = [];
                    if (rawChildren !== undefined) {
                        const kidTag = getTag(rawChildren);
                        const kidNode = nodeFromJson(rawChildren, kidTag).node;
                        tagKids = [kidNode];
                    }

                    const elemNode = CREATE_NODE( { _tag: tagName, _content: tagKids });
                    if (hoistedAttrs && Object.keys(hoistedAttrs).length) elemNode._attrs = hoistedAttrs;  // ← preserve
                    if (hoistedMeta && Object.keys(hoistedMeta).length) elemNode._meta = { ...elemNode._meta, ...hoistedMeta };

                    return elemNode;
                }

                _throw_transform_err(
                    `invalid item in "_elem"[${ix}] (must be string|number|boolean/null or element-object)`,
                    'parse_json',
                    make_string(val)
                );
            });

            return { node: CREATE_NODE({ _tag: ELEM_TAG, _meta: {}, _content: children }) };

        }

        // C) GENERIC OBJECT HANDLING → _obj
        assertNoForbiddenVSNKeysInJSON(obj, '[generic object check, parseJSON]');
        const propKeys = Object.keys(obj);

        const propertyNodes: HsonNode[] = propKeys.map((key) => {
            const raw = obj[key] as JsonValue;

            // build a child node for the property value WITHOUT collapsing "".
            let child: HsonNode;

            if (typeof raw === 'string') {
                // strings (including "") → _str(["..."])
                child = CREATE_NODE({
                    _tag: STR_TAG,
                    _meta: {},
                    _content: [raw] // "" preserved
                });
            } else if (
                typeof raw === 'number' ||
                typeof raw === 'boolean' ||
                raw === null
            ) {
                // numbers/booleans/null → _val([...])
                child = CREATE_NODE({
                    _tag: VAL_TAG,
                    _meta: {},
                    _content: [raw]
                });
            } else if (Array.isArray(raw)) {
                // arrays recurse under _arr
                child = nodeFromJson(raw, ARR_TAG).node;
            } else if (raw && typeof raw === 'object') {
                // objects recurse under _obj
                child = nodeFromJson(raw, OBJ_TAG).node;
            } else {
                _throw_transform_err(`unsupported JSON value for key "${key}"`, 'nodeFromJson.object.value');
            }

            // JSON-mode property ⇒ inner _obj wrapper unless the child is already a cluster
            const payload =
                (child._tag === OBJ_TAG || child._tag === ARR_TAG)
                    ? [child]                                    // passthrough single cluster
                    : [CREATE_NODE({ _tag: OBJ_TAG, _meta: {}, _content: [child] })]; // wrap leaf in _obj

            return CREATE_NODE({
                _tag: key,
                _meta: {},
                _content: payload
            });
        });

        return {
            node: CREATE_NODE({
                _tag: OBJ_TAG,
                _meta: {},
                _content: propertyNodes
            })
        };
    }

    // ---- Fallback (should be unreachable if callers set parentTag correctly) ----
    _throw_transform_err(`unhandled parentTag ${parentTag}`, 'nodeFromJson.dispatch');
}

/**
 * Parse JSON into a rooted `HsonNode` tree.
 *
 * Input handling:
 * - If `input` is a string, it is parsed with `JSON.parse`. Any parse
 *   error is wrapped and rethrown via `_throw_transform_err`.
 * - If `input` is already a `JsonValue`, it is used as-is.
 *
 * Legacy `_root` unwrapping:
 * - If the top-level value is an object of the form:
 *     `{ "_root": <payload>, "_meta"?: { ... } }`
 *   then:
 *   - `jsonToProcess` is set to `<payload>`.
 *   - Any `_meta` entries whose keys begin with the data-meta prefix
 *     (`data-_*`) are copied into `rootMeta` and attached to the final
 *     `_root` node.
 * - All other keys (including non-`data-_*` meta) are ignored for the
 *   purposes of root metadata.
 *
 * Conversion:
 * - Delegates to `nodeFromJson(jsonToProcess, getTag(jsonToProcess))`
 *   to build the main HSON subtree.
 * - Wraps the resulting node in a `_root` wrapper:
 *   - `_tag: ROOT_TAG`
 *   - `_meta: rootMeta` (if any data-meta was preserved)
 *   - `_content: [node]`
 * - Runs `assert_invariants` on the final root to ensure structural
 *   correctness.
 *
 * @param input - JSON string or already-parsed `JsonValue`.
 * @returns A `_root`-wrapped `HsonNode` representing the JSON payload.
 * @throws If JSON parsing fails or invariants are violated.
 * @see nodeFromJson
 * @see getTag
 * @see assert_invariants
 */
export function parse_json(input: string | JsonValue): HsonNode {
  let parsed: JsonValue;
  try {
    parsed = typeof input === "string" ? JSON.parse(input) : input;
  } catch (e) {
    _throw_transform_err(`invalid JSON input ${make_string(input)}`, "parse-json", String(e));
  }

  // unwrap legacy {_root: ...} but keep data-* meta (unchanged)
  let jsonToProcess: JsonValue = parsed;
  let rootMeta: HsonMeta | undefined;
  if (is_Object(parsed)) {
    const obj = parsed as JsonObj;
    const keys = Object.keys(obj).filter(k => k !== "_meta");
    if (keys.length === 1 && keys[0] === ROOT_TAG) {
      jsonToProcess = obj[ROOT_TAG] as JsonValue;
      if (obj._meta && is_Object(obj._meta)) {
        const filtered: HsonMeta = {};
        for (const [k, v] of Object.entries(obj._meta)) {
          if (k.startsWith(_META_DATA_PREFIX)) (filtered as any)[k] = v;
        }
        if (Object.keys(filtered).length) rootMeta = filtered;
      }
    }
  }

  
  // ------------------------------------------------------------------------------

  const { node } = nodeFromJson(jsonToProcess, getTag(jsonToProcess));
  const root = CREATE_NODE({
    _tag: ROOT_TAG,
    _meta: rootMeta,
    _content: [node],
  });
  assert_invariants(root, "root");
  return root;
}