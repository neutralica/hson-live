import type { LiveMap, LiveMapDefinitions, LiveMapKnownDefinitions } from "../../types/livemap.types.js";
import { admit_public_livemap_definitions, make_livemap_libraries } from "./livemap.libraries.js";

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
  return make_livemap_libraries(admit_public_livemap_definitions(libraries));
}

export const hsonLiveMap: HsonLiveMapFacade = /* @__PURE__ */ Object.freeze({
  create,
  fromLibraries,
});
