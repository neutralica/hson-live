import type { LiveMap, LiveMapInput } from "../types/livemap.types.js";
import { make_livemap_libraries } from "../api/livemap/livemap.libraries.js";

/** Exact construction for internally owned registry state. @internal */
export function admit_exact_runtime_livemap_libraries<const T extends LiveMapInput>(
  libraries: T,
): LiveMap<T> {
  return make_livemap_libraries(libraries);
}
