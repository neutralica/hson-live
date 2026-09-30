import type { LocusLibraryCatalogEntry } from "../../src/types/locus.projection.types.ts";
import { is_public_multi_library_livemap } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";

/** Existing transport suites deliberately classify every fixture library as shared. */
export function test_application_catalog(map: unknown): readonly LocusLibraryCatalogEntry[] {
  if (!is_public_multi_library_livemap(map)) return Object.freeze([]);
  const entries = internal_livemap_aggregate_authority(map).hostedRegistry().libraries
    .filter((entry) => entry.scope !== "hson-internal")
    .map((entry) => Object.freeze({ name: entry.name, ownership: "shared" as const }));
  return Object.freeze(entries);
}

/** Legacy complete-topology fixtures now opt in to the equivalent explicit Step 6A scope. */
export function test_public_projection(map: unknown) {
  const libraries = test_application_catalog(map);
  const registry = is_public_multi_library_livemap(map)
    ? internal_livemap_aggregate_authority(map).hostedRegistry() : undefined;
  const names = libraries.map((entry) => entry.name);
  const writableDocuments = registry?.libraries.filter((entry) => entry.mode === "document" && names.includes(entry.name))
    .map((entry) => entry.name) ?? [];
  const systemFeatures: ("interactions")[] = registry?.libraries.some((entry) => entry.scope === "hson-internal")
    ? ["interactions"] : [];
  return Object.freeze({ libraries,
    defaultProjection: Object.freeze({ libraries: names, systemFeatures }),
    authorizeProjection: () => Object.freeze({ libraries: names, writableDocuments, systemFeatures }),
  });
}
