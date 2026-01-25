// core.types.ts

/**
 * Primitive data type allowed in both JSON and HSON.
 *
 * Includes:
 *   • string
 *   • number
 *   • boolean
 *   • null
 *
 * This forms the leaf-level value domain for all parsed JSON/HSON
 * structures before they are lifted into HsonNodes.
 */
export type Primitive = string | boolean | number | null;

/**
 * Subset of Primitive consisting of non-string types:
 *   • boolean
 *   • number
 *   • null
 *
 * Used internally to differentiate primitives in contexts
 * where string handling (e.g. escaping, text-node serialization) follows
 * different rules from numeric/boolean/null values.
 */
export type BasicValue = boolean | number | null;

/**
 * A standard JavaScript object representing a JSON object literal.
 *
 * Notes:
 *   • Keys must be strings.
 *   • Values recursively follow `JsonValue`.
 *   • No prototype semantics are considered; this is purely
 *     structural JSON.
 */
export type JsonObj = { [key: string]: JsonValue };

/**
 * Recursive type representing any structurally valid JSON value.
 *
 * Variants:
 *   • Primitive (string | number | boolean | null)
 *   • JsonObj (object with string keys and JsonValue values)
 *   • JsonValue[] (arrays of any JSON value)
 *
 * This is the full domain accepted by the JSON→HSON parser prior to
 * normalization into HsonNode structures.
 */
export type JsonValue = Primitive |
    JsonObj |
    JsonValue[];

