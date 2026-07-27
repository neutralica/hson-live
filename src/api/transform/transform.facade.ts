import type { HsonNode, JsonValue } from "../../core/types.js";
import {
  transform_from_hson,
  transform_from_json,
  transform_from_node,
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./transform.universal.js";
import type {
  HsonTransformSource,
  OutputConstructor_2,
  TransformOutput,
} from "./transform.types.js";

export interface HsonTransformFacade {
  fromHson(input: string): HsonTransformSource;
  fromJson(input: string | JsonValue): TransformOutput;
  fromNode(node: HsonNode): TransformOutput;
  fromTrustedHtml(input: string): OutputConstructor_2;
  fromUntrustedHtml(input: string): OutputConstructor_2;
}

/**
 * Canonical DOM-free transformation facade.
 *
 * Its HTML constructors accept strings only and use the synchronous universal
 * parser. The complete `hson` umbrella retains browser-node overloads.
 */
export const hsonTransform: HsonTransformFacade = Object.freeze({
  fromHson: transform_from_hson,
  fromJson: transform_from_json,
  fromNode: transform_from_node,
  fromTrustedHtml: transform_from_trusted_html,
  fromUntrustedHtml: transform_from_untrusted_html,
});
