import type { HsonNode } from "../core/types.js";
import type { ClassifiedLiveMap, LiveMapLibraries, LiveMapLibrariesInput } from "../types/livemap.types.js";
import { make_classified_livemap } from "../api/livemap/livemap.core.js";
import { make_livemap_libraries } from "../api/livemap/livemap.libraries.js";

/**
 * Temporary local identity-sensitive graph admission for hosted and recovery
 * compatibility. Public LiveMap.fromNode must never call this route.
 * @internal
 */
export function admit_exact_runtime_livemap_node(node: HsonNode): ClassifiedLiveMap {
  return make_classified_livemap(node);
}

/** Temporary exact construction for internally owned multi-library state. @internal */
export function admit_exact_runtime_livemap_libraries<const T extends LiveMapLibrariesInput>(
  libraries: T,
): LiveMapLibraries<T> {
  return make_livemap_libraries(libraries);
}
