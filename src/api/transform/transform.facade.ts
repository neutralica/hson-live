import type { HsonNode, JsonValue } from "../../core/types.js";
import {
  transform_from_hson,
  transform_from_binary,
  transform_from_json,
  transform_from_json_value,
  transform_from_node,
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./transform.universal.js";
import type {
  BinaryDecodeOptions,
  HsonTransformSource,
  TransformOutput,
} from "./transform.types.js";
import { hsonCalc, type HsonNumber } from "./hson-calc.js";

export interface HsonTransformFacade {
  calc(value: number | (() => number)): HsonNumber;
  fromHson(input: string): HsonTransformSource;
  fromBinary(input: Uint8Array, options?: BinaryDecodeOptions): TransformOutput;
  /** Reads top-level strings as serialized JSON and other inputs as native values. */
  fromJson(input: string | JsonValue): TransformOutput;
  /** Admits a native JSON value. Top-level strings are used literally. */
  fromJsonValue(value: JsonValue): TransformOutput;
  fromNode(node: HsonNode): TransformOutput;
  fromTrustedHtml(input: string): TransformOutput;
  fromUntrustedHtml(input: string): TransformOutput;
}

/**
 * Canonical DOM-free transformation facade.
 *
 * Its HTML constructors accept strings only and use the synchronous universal
 * parser. The complete `hson` umbrella retains browser-node overloads.
 */
export const hsonTransform: HsonTransformFacade = Object.freeze({
  calc: hsonCalc,
  fromHson: transform_from_hson,
  fromBinary: transform_from_binary,
  fromJson: transform_from_json,
  fromJsonValue: transform_from_json_value,
  fromNode: transform_from_node,
  fromTrustedHtml: transform_from_trusted_html,
  fromUntrustedHtml: transform_from_untrusted_html,
});
