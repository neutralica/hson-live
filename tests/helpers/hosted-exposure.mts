import type { LocusExposureEntry } from "../../src/types/locus.projection.types.ts";
import { is_public_multi_library_livemap } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";

/** Existing transport suites deliberately classify every fixture library as client-public. */
export function test_public_exposure(map: unknown): readonly LocusExposureEntry[] {
  if (!is_public_multi_library_livemap(map)) return Object.freeze([]);
  const entries = internal_livemap_aggregate_authority(map).hostedRegistry().libraries
    .filter((entry) => entry.scope !== "hson-internal")
    .map((entry) => Object.freeze({ library: entry.name, exposure: "client-public" as const }));
  return Object.freeze(entries);
}

/** Legacy complete-topology fixtures now opt in to the equivalent explicit Step 6A scope. */
export function test_public_projection(map: unknown) {
  const exposure = test_public_exposure(map);
  const registry = is_public_multi_library_livemap(map)
    ? internal_livemap_aggregate_authority(map).hostedRegistry() : undefined;
  const names = exposure.map((entry) => entry.library);
  const writableDocuments = registry?.libraries.filter((entry) => entry.mode === "document" && names.includes(entry.name))
    .map((entry) => entry.name) ?? [];
  const systemFeatures: ("interactions")[] = registry?.libraries.some((entry) => entry.scope === "hson-internal")
    ? ["interactions"] : [];
  return Object.freeze({ exposure,
    defaultProjection: Object.freeze({ libraries: names, systemFeatures }),
    authorizeProjection: () => Object.freeze({ libraries: names, writableDocuments, systemFeatures }),
  });
}
