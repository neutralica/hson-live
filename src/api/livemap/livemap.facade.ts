import type { LiveMap, LiveMapDefinitions, LiveMapKnownDefinitions } from "../../types/livemap.types.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { make_livemap_libraries } from "./livemap.libraries.js";

export interface HsonLiveMapFacade {
  readonly create: typeof create;
  readonly fromLibraries: typeof fromLibraries;
}

/** Construct a fully initialized LiveMap with no application libraries. */
export function create(): LiveMap<{}> {
  return make_livemap_libraries({});
}

/** Establish one named local Library registry. */
export function fromLibraries<const TLibraries extends LiveMapDefinitions>(libraries: TLibraries): LiveMap<LiveMapKnownDefinitions<TLibraries>> {
  for (const [name, input] of Object.entries(libraries)) {
    if ("document" in input && input.document !== undefined && typeof input.document !== "string") {
      admit_portable_hson_node(input.document, `LiveMap.fromLibraries(${name})`);
    }
  }
  return make_livemap_libraries(libraries);
}

export const hsonLiveMap: HsonLiveMapFacade = /* @__PURE__ */ Object.freeze({
  create,
  fromLibraries,
});
