// serialize-primitive.utils.ts

import { Primitive } from "../../types/core.types";

/**
 * Serialize a primitive into its string representation.
 *
 * Behavior:
 * - Strings use `JSON.stringify` to preserve quotes and escapes.
 * - Numbers, booleans, and null are stringified directly.
 *
 * @param prim - The primitive value to serialize.
 * @returns The serialized string representation.
 */

export function serialize_primitive_hson(prim: Primitive): string {

  /* if the primitive is a string, just serialize it as a string. */
    if (typeof prim === 'string') {
      return JSON.stringify(prim);
    }
  
    /* if it's bool/num/null, serialize it as a raw literal */
    return String(prim);
  }
