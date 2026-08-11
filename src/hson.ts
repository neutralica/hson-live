import {
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./api/transform/transform.browser.js";
import { hsonTransform } from "./api/transform/transform.facade.js";
import { hsonString } from "./api/transform/hson-string.js";
import { hsonNumber } from "./api/transform/hson-number.js";
import { hsonCalc } from "./api/transform/hson-calc.js";
import { hsonLiveMap } from "./api/livemap/livemap.facade.js";
import { hsonLiveMapBrowser } from "./api/livemap/livemap.compat.js";
import { hsonLiveTree } from "./api/livetree/livetree.facade.js";
import {
  hsonLiveHost,
  liveHost,
} from "./api/livehost/livehost.facade.js";
import { hsonReflect } from "./api/reflect/reflect.facade.js";
import { hsonInspect } from "./api/liveinspect/liveinspect.facade.js";
import type {
  HsonTransformSource,
  TransformOutput,
} from "./api/transform/transform.types.js";
import type { HsonNode, JsonValue } from "./core/types.js";
import type { OutputConstructor_2 } from "./types/constructor.types.js";

export {
  hsonLiveHost,
  hsonLiveMap,
  hsonLiveTree,
  hsonReflect,
  hsonTransform,
  hsonString,
  hsonNumber,
  hsonCalc,
  liveHost,
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

/**
 * Complete browser/full-ecosystem convenience facade.
 *
 * Dedicated package subpaths expose the narrower canonical subsystem
 * boundaries. This umbrella retains browser HTML compatibility methods and
 * the established source-constructor shortcuts.
 */
export interface HsonFacade {
  transform: typeof hsonTransform;
  fromHson: (input: string) => HsonTransformSource;
  fromJson: (input: string | JsonValue) => TransformOutput;
  fromNode: (node: HsonNode) => TransformOutput;
  fromTrustedHtml: (input: string | Element) => OutputConstructor_2;
  fromUntrustedHtml: (input: string | Element) => OutputConstructor_2;
  liveMap: typeof hsonLiveMapBrowser;
  liveTree: typeof hsonLiveTree;
  liveHost: typeof hsonLiveHost;
  reflect: typeof hsonReflect;
  inspect: typeof hsonInspect;
}

export const hson: HsonFacade = {
  transform: hsonTransform,
  fromHson: hsonTransform.fromHson,
  fromJson: hsonTransform.fromJson,
  fromNode: hsonTransform.fromNode,
  fromTrustedHtml: transform_from_trusted_html,
  fromUntrustedHtml: transform_from_untrusted_html,

  // Browser compatibility superset: the canonical DOM-free object is
  // available as `hsonLiveMap`.
  liveMap: hsonLiveMapBrowser,
  liveTree: hsonLiveTree,
  liveHost: hsonLiveHost,

  reflect: hsonReflect,
  inspect: hsonInspect,
};
