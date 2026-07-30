import {
  transform_from_trusted_html,
  transform_from_untrusted_html,
} from "./api/transform/transform.browser.js";
import { hsonTransform } from "./api/transform/transform.facade.js";
import { hsonString } from "./api/transform/hson-string.js";
import { hsonLiveMap } from "./api/livemap/livemap.facade.js";
import { hsonLiveMapBrowser } from "./api/livemap/livemap.compat.js";
import { hsonLiveTree } from "./api/livetree/livetree.facade.js";
import {
  hsonLiveHost,
  liveHost,
} from "./api/livehost/livehost.facade.js";
import { hsonReflect } from "./api/liveproject/liveproject.facade.js";
import { hsonInspect } from "./api/liveinspect/liveinspect.facade.js";
import type {
  HsonString,
  HsonTransformSource,
  TransformOutput,
} from "./api/transform/transform.types.js";
import type { HsonNode, JsonValue } from "./core/types.js";
import type { OutputConstructor_2 } from "./types/constructor.types.js";

export {
  hsonLiveHost,
  hsonLiveMap,
  hsonLiveTree,
  hsonTransform,
  hsonString,
  liveHost,
};

/**
 * Complete browser/full-ecosystem convenience facade.
 *
 * Dedicated package subpaths expose the narrower canonical subsystem
 * boundaries. This umbrella retains browser HTML compatibility methods and
 * all historical shortcuts.
 */
export interface HsonFacade {
  transform: typeof hsonTransform;
  string: (source: string) => HsonString;
  fromHson: (input: string) => HsonTransformSource;
  fromJson: (input: string | JsonValue) => TransformOutput;
  fromNode: (node: HsonNode) => TransformOutput;
  fromTrustedHtml: (input: string | Element) => OutputConstructor_2;
  fromUntrustedHtml: (input: string | Element) => OutputConstructor_2;
  liveMap: typeof hsonLiveMapBrowser;
  liveTree: typeof hsonLiveTree;
  liveHost: typeof hsonLiveHost;
  reflect: typeof hsonReflect;
  liveProject: typeof hsonReflect;
  inspect: typeof hsonInspect;
}

export const hson: HsonFacade = {
  transform: hsonTransform,

  string: hsonString,
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
  liveProject: hsonReflect,
  inspect: hsonInspect,
};
