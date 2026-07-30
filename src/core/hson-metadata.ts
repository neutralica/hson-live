import {
  EVERY_VSN,
  II_TAG,
  _DATA_INDEX,
  _DATA_QUID,
} from "./constants.js";
import { is_valid_hson_attribute_name } from "./hson-name.js";

export type HsonMetadataPolicyResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: string }>;

/**
 * The reserved metadata namespace is an exact field/node-kind matrix.
 * Prefix membership alone never defines a valid metadata field.
 */
export function hson_metadata_policy(
  nodeTag: string,
  key: string,
): HsonMetadataPolicyResult {
  if (!is_valid_hson_attribute_name(key)) {
    return { valid: false, reason: "the key is not a valid unquoted HSON metadata name" };
  }

  if (EVERY_VSN.includes(nodeTag)) {
    if (nodeTag === II_TAG && key === _DATA_INDEX) return { valid: true };
    return {
      valid: false,
      reason: `the reserved metadata key is not defined for structural VSN "${nodeTag}"`,
    };
  }

  if (key === _DATA_QUID) return { valid: true };
  return {
    valid: false,
    reason: `the reserved metadata key is not defined for standard tag "${nodeTag}"`,
  };
}
