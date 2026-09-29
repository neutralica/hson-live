import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import type { LiveMap, LiveMapInput } from "../../types/livemap.types.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { make_livemap_mirror_from_portable_aggregate_internal } from "../livemap/livemap.libraries.js";
import {
  authority_projection_as_client_composition_internal,
  bind_client_projection_identity_internal,
} from "../locus/locus.authority-projection-snapshot.js";

/** @internal Admit a cut and construct a fresh client runtime. Local composition remains an internal invariant seam. */
export function compose_client_projection_internal(
  authority: AuthorityProjectionSnapshot,
  localLibraries: LiveMapInput = {},
): LiveMap {
  for (const [name, definition] of Object.entries(localLibraries)) {
    if ("document" in definition && definition.document !== undefined && typeof definition.document !== "string") {
      admit_portable_hson_node(definition.document, `Client local library (${name})`);
    }
  }
  const map = make_livemap_mirror_from_portable_aggregate_internal(
    authority_projection_as_client_composition_internal(authority), localLibraries);
  bind_client_projection_identity_internal(map, authority);
  return map;
}
