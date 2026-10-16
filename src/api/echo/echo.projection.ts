import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import type { LocusLocalInitializer } from "../../types/locus.projection.types.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type { PortableAggregateSnapshot } from "../livemap/livemap.hosted.internal.types.js";
import { HsonSchema } from "../schema/hson-schema.js";
import {
  make_livemap_from_canonical_libraries_internal,
  type CanonicalLibraryDefinition,
  portable_aggregate_inputs_internal,
} from "../livemap/livemap.libraries.js";
import { decode_hosted_root, HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { interaction_schema_internal } from "../interactions/interactions.projection.js";
import { INTERACTION_RESERVED_LIBRARY_KEY, INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME } from "../../internal/interaction-storage.js";
import { admit_locus_local_initializers, retain_client_local_seed_contracts_internal } from "../locus/locus.local-initializer.js";
import type { DocumentCssRecord } from "../../types/document-css.types.js";
import {
  admit_authority_projection_snapshot,
  authority_projection_as_client_composition_internal,
  bind_client_projection_identity_internal,
} from "../locus/locus.authority-projection-snapshot.js";

/** @internal Admit current session composition and construct one fresh client runtime. */
export function compose_client_projection_internal(
  authority: AuthorityProjectionSnapshot,
  local: readonly LocusLocalInitializer[],
  scoped = false,
): LiveMap {
  const admitted = admit_authority_projection_snapshot(authority, scoped);
  const snapshot = authority_projection_as_client_composition_internal(admitted, scoped);
  const map = compose_client_portable_aggregate_internal(snapshot, local, scoped);
  bind_client_projection_identity_internal(map, admitted, scoped);
  return map;
}

/** Construct one composed client map from admitted authority and canonical local material. @internal */
export function compose_client_portable_aggregate_internal(
  snapshot: PortableAggregateSnapshot,
  local: readonly LocusLocalInitializer[],
  scoped = false,
): LiveMap {
  const admitted = portable_aggregate_inputs_internal(snapshot, scoped);
  // Keep the established Library order while admitting each complete seed.
  // The name set below rejects duplicate local and projected names together.
  const initializers = local.flatMap(initializer => admit_locus_local_initializers([initializer]));
  const inputs: CanonicalLibraryDefinition[] = [...admitted.inputs];
  const css: Record<string, DocumentCssRecord> = Object.create(null);
  const names = new Set(inputs.map((entry) => entry.name));
  for (const initializer of initializers) {
    if (names.has(initializer.name)) {
      throw new Error(`Local initializer ${JSON.stringify(initializer.name)} collides with shared state.`);
    }
    const root = decode_hosted_root(initializer.root, HOSTED_MAX_SNAPSHOT_BYTES);
    const schema = HsonSchema.fromHson(initializer.schema);
    names.add(initializer.name);
    inputs.push({ name: initializer.name, family: initializer.mode === "document" ? "document" : "data", root, schema, ...(initializer.validation === undefined ? {} : { validation: initializer.validation }) });
    if (initializer.css !== undefined) css[initializer.name] = initializer.css;
  }
  if (inputs.length === 0) {
    throw new Error("An action-only client session has no LiveMap; use endpoint-only Echo.");
  }
  const localDocumentExists = initializers.some((initializer) => initializer.mode === "document");
  const systems = admitted.systems.length > 0 || !localDocumentExists ? admitted.systems : [Object.freeze({
    key: INTERACTION_RESERVED_LIBRARY_KEY,
    transportName: INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
    root: hsonTransform.fromJson({ descriptors: [] }).toNode(),
    hsonSchema: interaction_schema_internal(),
  })];
  const map = make_livemap_from_canonical_libraries_internal(Object.freeze(inputs), systems, snapshot, css, scoped);
  retain_client_local_seed_contracts_internal(map, initializers);
  return map;
}
