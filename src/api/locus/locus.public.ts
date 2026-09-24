import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type { LocusActionPayloads, LocusMultiLibrary, LocusMultiLibraryOptions } from "../../types/locus.types.js";
import type { PersistentLocusMultiLibrary, PersistentLocusMultiLibraryOptions } from "../../types/locus.types.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { create_multi_library_locus } from "./locus.multi-library.js";
import { create_persistent_multi_library_locus } from "./locus.multi-library.persistence.js";

/** Construct the sole hosted Locus model: a fixed application library registry. */
export function create_locus<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: LocusMultiLibraryOptions<TMap, TActions>): LocusMultiLibrary<TMap, TActions> {
  if (typeof options !== "object" || options === null || !is_public_multi_library_livemap(options.map)) {
    throw new TypeError("Hosted Locus requires a fixed library registry and explicit exposure policy.");
  }
  return create_multi_library_locus(options);
}

/** Durable authority uses the same fixed registry and projection policy. */
export async function create_persistent_locus<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: PersistentLocusMultiLibraryOptions<TMap, TActions>): Promise<PersistentLocusMultiLibrary<TMap, TActions>> {
  if (typeof options !== "object" || options === null || !is_public_multi_library_livemap(options.map)) {
    throw new TypeError("Persistent hosted Locus requires a fixed library registry and explicit exposure policy.");
  }
  return create_persistent_multi_library_locus(options);
}
