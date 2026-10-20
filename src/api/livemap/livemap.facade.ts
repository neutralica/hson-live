import type { LiveMap, LiveMapDefinitions, LiveMapKnownDefinitions, LiveMapDefinitionsCheck } from "../../types/livemap.types.js";
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
export function fromLibraries<const TLibraries extends LiveMapDefinitions>(libraries: TLibraries & LiveMapDefinitionsCheck<NoInfer<TLibraries>>): LiveMap<LiveMapKnownDefinitions<TLibraries>> {
  const captured = admit_public_livemap_definitions(libraries);
  return make_livemap_libraries(captured.definitions, [], undefined, captured.css) as LiveMap<LiveMapKnownDefinitions<TLibraries>>;
}

export const hsonLiveMap: HsonLiveMapFacade = /* @__PURE__ */ Object.freeze({
  create,
  fromLibraries,
});
