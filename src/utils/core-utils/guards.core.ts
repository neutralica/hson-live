// guards.core.ts


import { BasicValue, JsonObj, JsonValue, Primitive } from "../../types/core.types.js";


/**
 * Determine whether a value is a JSON object (non-null, non-array, typeof === "object").
 *
 * This intentionally excludes:
 *   • null
 *   • arrays
 *   • functions / class instances
 *
 * Used by the JSON→HSON parser to identify true object literals before
 * recursing through their keys.
 *
 * @param x - Value to test.
 * @returns True when `x` is a plain JSON object.
 */
export function is_Object(x: any): x is JsonObj {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Identify whether a value is a JSON/HSON primitive:
 *   • string
 *   • number
 *   • boolean
 *   • null
 *
 * This is the broad leaf-level domain for HSON parsing and serialization.
 * Unlike `is_not_string`, this does *not* enforce non-string primitives.
 *
 * @param x - Value to test.
 * @returns True when `x` is a primitive.
 */
export function is_Primitive(x: any): x is Primitive {
  return x === null || ["string", "number", "boolean"].includes(typeof x);
}


/**
 * Type guard for any JSON value that is *not* a string but *is* a BasicValue:
 *   • number
 *   • boolean
 *   • null
 *
 * Used mainly when `string` must be handled separately (e.g. escaping,
 * text-node production) while leaving the remaining primitive space grouped.
 *
 * @param txt - Value to test.
 * @returns True when `txt` is a non-string primitive.
 */
export function is_not_string(txt: JsonValue): txt is BasicValue {
  return (typeof txt === 'number' ||
    txt === null ||
    typeof txt === 'boolean')
}

/**
 * Type guard for `string` within the broader `JsonValue` union.
 *
 * Useful for separating string-specific escaping/normalization paths from
 * number/boolean/null primitives during parsing and serialization.
 *
 * @param txt - Value to test.
 * @returns True when `txt` is a string.
 */
export function is_string(txt: JsonValue): txt is string {
  return (typeof txt === 'string')
}

/**
 * Determine whether a content array represents an empty node.
 *
 * A “void” node in HSON terms is simply one whose `_content` array is
 * present but contains no items. This check does not consider tag type,
 * only the structural emptiness.
 *
 * @param content - Node content array to test.
 * @returns True when the content array is empty.
 */
export function is_void_node(content: readonly unknown[]) {
  return (content.length === 0);
}

/**
 * Identify a plain object suitable for JSON/HSON structural recursion.
 *
 * Conditions:
 *   • value is truthy
 *   • typeof === "object"
 *   • not an array
 *
 * Does not check prototypes, but excludes `null` and arrays. Used as a
 * defensive filter before inspecting unknown incoming data.
 *
 * @param x - Value to test.
 * @returns True when `x` is a non-array object.
 */
export function is_plain_object(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
