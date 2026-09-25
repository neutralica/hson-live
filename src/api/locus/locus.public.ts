import type { LiveMap } from "../../types/livemap.types.js";
import type { LocusActionPayloads, Locus, LocusOptions } from "../../types/locus.types.js";
import type { PersistentLocus, PersistentLocusOptions } from "../../types/locus.types.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { create_registry_locus } from "./locus.registry.js";
import { create_persistent_registry_locus } from "./locus.registry.persistence.js";

/** Construct a hosted Locus over an application library registry. */
export function create_locus<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: LocusOptions<TMap, TActions>): Locus<TMap, TActions> {
  if (typeof options !== "object" || options === null || !is_public_multi_library_livemap(options.map)) {
    throw new TypeError("Hosted Locus requires a library registry and explicit exposure policy.");
  }
  return create_registry_locus(options);
}

/** Durable authority uses the same registry and projection policy. */
export async function create_persistent_locus<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: PersistentLocusOptions<TMap, TActions>): Promise<PersistentLocus<TMap, TActions>> {
  if (typeof options !== "object" || options === null || !is_public_multi_library_livemap(options.map)) {
    throw new TypeError("Persistent hosted Locus requires a library registry and explicit exposure policy.");
  }
  return create_persistent_registry_locus(options);
}
