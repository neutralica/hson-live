import {
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./api/transform/transform.browser.js";
import { hsonTransform } from "./api/transform/transform.facade.js";
import { hsonCalc } from "./api/transform/hson-calc.js";
import { hsonLiveMap } from "./api/livemap/livemap.public.js";
import { hsonLiveTree } from "./api/livetree/livetree.facade.js";
import { hsonLiveHost } from "./api/livehost/livehost.facade.js";
import { hsonMirror } from "./api/mirror/mirror.facade.js";
import type {
  HsonTransformSource,
  BinaryDecodeOptions,
  TransformOutput,
} from "./api/transform/transform.types.js";
import type { HsonNode, JsonValue } from "./core/types.js";

export {
  hsonLiveMap,
  hsonLiveTree,
  hsonLiveHost,
  hsonMirror,
  hsonTransform,
  hsonCalc,
};
export {
  TransformError,
  is_transform_error,
  read_transform_error_details,
} from "./core/errors.js";
export type {
  TransformErrorDetails,
  TransformErrorRelated,
  TransformErrorSource,
} from "./core/errors.js";
export type {
  BinaryDecodeOptions,
  TransformBinarySerialize,
} from "./api/transform/transform.types.js";

/**
 * Complete browser/full-ecosystem convenience facade.
 *
 * Dedicated package subpaths expose the narrower canonical subsystem
 * boundaries. This umbrella retains browser HTML compatibility methods and
 * the established source-constructor shortcuts.
 */
export interface HsonFacade {
  readonly transform: typeof hsonTransform;
  readonly fromHson: (input: string) => HsonTransformSource;
  readonly fromBinary: (input: Uint8Array, options?: BinaryDecodeOptions) => TransformOutput;
  readonly fromJson: (input: string | JsonValue) => TransformOutput;
  readonly fromNode: (node: HsonNode) => TransformOutput;
  readonly fromTrustedHtml: (input: string | Element) => TransformOutput;
  readonly fromUntrustedHtml: (input: string | Element) => TransformOutput;
  readonly liveMap: typeof hsonLiveMap;
  readonly liveTree: typeof hsonLiveTree;
  readonly liveHost: typeof hsonLiveHost;
  readonly mirror: typeof hsonMirror;
}

export const hson: HsonFacade = Object.freeze({
  transform: hsonTransform,
  fromHson: hsonTransform.fromHson,
  fromBinary: hsonTransform.fromBinary,
  fromJson: hsonTransform.fromJson,
  fromNode: hsonTransform.fromNode,
  fromTrustedHtml: transform_from_trusted_html,
  fromUntrustedHtml: transform_from_untrusted_html,

  liveMap: hsonLiveMap,
  liveTree: hsonLiveTree,
  liveHost: hsonLiveHost,

  mirror: hsonMirror,
});
