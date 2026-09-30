import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import type { LocusLocalInitializer } from "../../types/locus.projection.types.js";
import type { LiveMap, LiveMapDefinitions } from "../../types/livemap.types.js";
import type { PortableAggregateSnapshot } from "../livemap/livemap.hosted.internal.types.js";
import { HsonSchema } from "../schema/hson-schema.js";
import {
  make_livemap_libraries,
  portable_aggregate_inputs_internal,
  reconstructed_data_internal,
} from "../livemap/livemap.libraries.js";
import { decode_hosted_root, HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted.js";
import { apply_client_local_initializer_css_internal } from "../locus/locus.local-initializer.js";
import {
  authority_projection_as_client_composition_internal,
  bind_client_projection_identity_internal,
} from "../locus/locus.authority-projection-snapshot.js";

/** @internal Admit current session composition and construct one fresh client runtime. */
export function compose_client_projection_internal(
  authority: AuthorityProjectionSnapshot,
  local: readonly LocusLocalInitializer[],
): LiveMap {
  const snapshot = authority_projection_as_client_composition_internal(authority);
  const map = compose_client_portable_aggregate_internal(snapshot, local);
  bind_client_projection_identity_internal(map, authority);
  return map;
}

/** Construct one composed client map from admitted authority and canonical local material. @internal */
export function compose_client_portable_aggregate_internal(
  snapshot: PortableAggregateSnapshot,
  local: readonly LocusLocalInitializer[],
): LiveMap {
  const admitted = portable_aggregate_inputs_internal(snapshot);
  const inputs: Record<string, LiveMapDefinitions[string]> = Object.assign(Object.create(null), admitted.inputs);
  for (const initializer of local) {
    if (Object.hasOwn(inputs, initializer.name)) {
      throw new Error(`Local initializer ${JSON.stringify(initializer.name)} collides with shared state.`);
    }
    const root = decode_hosted_root(initializer.root, HOSTED_MAX_SNAPSHOT_BYTES);
    const schema = HsonSchema.fromHson(initializer.schema);
    inputs[initializer.name] = initializer.mode === "document"
      ? { document: root, schema }
      : { data: reconstructed_data_internal(root), schema };
  }
  if (Object.keys(inputs).length === 0) {
    throw new Error("An action-only client session has no LiveMap; use endpoint-only Echo.");
  }
  const map = make_livemap_libraries(Object.freeze(inputs), admitted.systems, snapshot);
  apply_client_local_initializer_css_internal(map, local);
  return map;
}
