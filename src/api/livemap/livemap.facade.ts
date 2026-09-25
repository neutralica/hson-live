import type { LiveMap, LiveMapInput, LiveMapDefinitions } from "../../types/livemap.types.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { make_livemap_libraries, make_livemap_mirror_from_portable_aggregate_internal } from "./livemap.libraries.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import { authority_projection_as_client_composition_internal, bind_client_projection_identity_internal } from "../locus/locus.authority-projection-snapshot.js";

export interface HsonLiveMapFacade {
  readonly create: typeof create;
  readonly fromLibraries: typeof fromLibraries;
  readonly fromClientSnapshot: typeof fromClientSnapshot;
}

/** Construct a fully initialized LiveMap with no application libraries. */
function create(): LiveMap<{}> {
  return make_livemap_libraries({});
}

/** Establish one named local Library registry. */
function fromLibraries<const TLibraries extends LiveMapDefinitions>(libraries: TLibraries): LiveMap<TLibraries> {
  for (const [name, input] of Object.entries(libraries)) {
    if ("document" in input && input.document !== undefined && typeof input.document !== "string") {
      admit_portable_hson_node(input.document, `LiveMap.fromLibraries(${name})`);
    }
  }
  return make_livemap_libraries(libraries);
}

/** Compose one client registry from visible authority state and client-owned declarations. */
function fromClientSnapshot(input: Readonly<{
  authority: AuthorityProjectionSnapshot;
  localLibraries: LiveMapInput;
}>): LiveMap {
  if (typeof input !== "object" || input === null) throw new TypeError("Client LiveMap configuration is required.");
  for (const [name, definition] of Object.entries(input.localLibraries)) {
    if ("document" in definition && definition.document !== undefined && typeof definition.document !== "string") {
      admit_portable_hson_node(definition.document, `LiveMap.fromClientSnapshot(${name})`);
    }
  }
  const map = make_livemap_mirror_from_portable_aggregate_internal(
    authority_projection_as_client_composition_internal(input.authority), input.localLibraries);
  bind_client_projection_identity_internal(map, input.authority);
  return map;
}

export const hsonLiveMap: HsonLiveMapFacade = Object.freeze({
  create,
  fromLibraries,
  fromClientSnapshot,
});
