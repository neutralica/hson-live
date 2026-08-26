import {
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./api/transform/transform.browser.js";
import { hsonTransform } from "./api/transform/transform.facade.js";
import { admit_hson } from "./api/transform/hson-admission.js";
import { hsonCalc } from "./api/transform/hson-calc.js";
import { hsonLiveMap } from "./api/livemap/livemap.facade.js";
import { hsonLiveMapBrowser } from "./api/livemap/livemap.compat.js";
import { hsonLiveTree } from "./api/livetree/livetree.facade.js";
import { hsonLocus } from "./api/locus/locus.facade.js";
import { hsonReflect } from "./api/reflect/reflect.facade.js";
import { hsonInspect } from "./api/inspect/liveinspect.facade.js";
import type {
  HsonTransformSource,
  BinaryDecodeOptions,
  TransformOutput,
} from "./api/transform/transform.types.js";
import type { HsonNode, JsonValue } from "./core/types.js";
import type { OutputConstructor_2 } from "./types/constructor.types.js";

export {
  hsonLocus,
  hsonLiveMap,
  hsonLiveTree,
  hsonReflect,
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
  (
    strings: TemplateStringsArray,
    ...values: readonly (string | number | boolean | null)[]
  ): import("./api/transform/transform.types.js").HsonCanonical;
  readonly transform: typeof hsonTransform;
  readonly fromHson: (input: string) => HsonTransformSource;
  readonly fromBinary: (input: Uint8Array, options?: BinaryDecodeOptions) => TransformOutput;
  readonly fromJson: (input: string | JsonValue) => TransformOutput;
  readonly fromNode: (node: HsonNode) => TransformOutput;
  readonly fromTrustedHtml: (input: string | Element) => OutputConstructor_2;
  readonly fromUntrustedHtml: (input: string | Element) => OutputConstructor_2;
  readonly liveMap: typeof hsonLiveMapBrowser;
  readonly liveTree: typeof hsonLiveTree;
  readonly locus: typeof hsonLocus;
  readonly reflect: typeof hsonReflect;
  readonly inspect: typeof hsonInspect;
}

export const hson: HsonFacade = Object.freeze(Object.assign(admit_hson, {
  transform: hsonTransform,
  fromHson: hsonTransform.fromHson,
  fromBinary: hsonTransform.fromBinary,
  fromJson: hsonTransform.fromJson,
  fromNode: hsonTransform.fromNode,
  fromTrustedHtml: transform_from_trusted_html,
  fromUntrustedHtml: transform_from_untrusted_html,

  // Browser compatibility superset: the canonical DOM-free object is
  // available as `hsonLiveMap`.
  liveMap: hsonLiveMapBrowser,
  liveTree: hsonLiveTree,
  locus: hsonLocus,

  reflect: hsonReflect,
  inspect: hsonInspect,
}));
