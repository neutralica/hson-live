// coerce-string.utils.ts

import type { HsonSemanticPrimitive } from "../../../../core/types.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";
import { admit_hson_number } from "../../../../core/hson-number.js";

const HSON_NUMBER_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Coerce a raw token string into a `Primitive` value.
 *
 * Rules:
 * - Trims leading/trailing whitespace.
 * - If the trimmed string is empty, returns `""`.
 * - If the value is double-quoted (`"..."`), it is treated as an explicitly
 *   quoted string literal and decoded with `JSON.parse` (so escapes like `\"`,
 *   `\\n`, and `\uXXXX` are honored). Parse failure is treated as a transform error.
 * - If unquoted, recognizes the keywords `true`, `false`, and `null`.
 * - If unquoted and numeric (including decimals and scientific notation), returns a `number`.
 * - Otherwise returns the trimmed string as-is.
 *
 * Notes:
 * - This function does **not** treat single-quoted strings as quoted literals.
 * - It does **not** recognize `undefined`; unknown identifiers remain strings.
 *
 * @param value - Raw input string to coerce.
 * @returns The coerced `Primitive` value.
 */
export function coerce(value: string): HsonSemanticPrimitive {
    const trimmed = value.trim();
    if (trimmed === '') {
        return '';
    }
    /* 1. check for a quoted string literal first */
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
            /*  it was explicitly a string; the parsed value is the content */
            return JSON.parse(trimmed);
        } catch (e) {
            /*  malformed, treat as a plain string of its inner content */
            const msg = e instanceof Error ? e.message : e;
            _throw_transform_err(`error in coercion: ${msg}`, 'coerce', value)
        }
    }
    /* 2. check for unquoted primitive keywords */
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;

    /* 3. check for a string that is purely numeric */

  
    if (HSON_NUMBER_LITERAL.test(trimmed)) {
        return admit_hson_number(Number(trimmed));
    }

    /* 4. if all else fails, it's a plain, unquoted string */
    return trimmed;
}
