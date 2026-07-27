import type { DocumentLiveMap } from "../../types/livemap.types.js";
import { is_svg_markup } from "../transform/utils/node-utils/node-from-svg.js";
import {
  SAFE_TRANSFORM_SOURCE,
  UNSAFE_TRANSFORM_SOURCE,
} from "../transform/transform.browser.js";
import { make_classified_livemap } from "./livemap.core.js";
import { hsonLiveMap } from "./livemap.facade.js";

export type HsonLiveMapBrowserFacade = typeof hsonLiveMap & {
  fromTrustedHtml(input: string): DocumentLiveMap;
  fromUntrustedHtml(input: string): DocumentLiveMap;
};

function must_document_livemap(
  map: ReturnType<typeof make_classified_livemap>,
  source: string,
): DocumentLiveMap {
  if (map.mode === "element" || map.mode === "fragment") return map;
  throw new Error(`LiveMap ${source} HTML construction produced unexpected root mode ${map.mode}.`);
}

function trusted_document_node(input: string) {
  const source = is_svg_markup(input.trimStart())
    ? input
    : `<_hson_root>${input}</_hson_root>`;
  return UNSAFE_TRANSFORM_SOURCE.fromHtml(source, { sanitize: false }).toNode();
}

/**
 * Browser compatibility superset retained at `hson.liveMap`.
 *
 * The canonical `hsonLiveMap` object remains the narrow DOM-free boundary.
 */
export const hsonLiveMapBrowser: HsonLiveMapBrowserFacade = {
  ...hsonLiveMap,
  fromTrustedHtml(input: string): DocumentLiveMap {
    return must_document_livemap(
      make_classified_livemap(trusted_document_node(input)),
      "trusted",
    );
  },
  fromUntrustedHtml(input: string): DocumentLiveMap {
    return must_document_livemap(
      make_classified_livemap(
        SAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: true }).toNode(),
      ),
      "untrusted",
    );
  },
};
