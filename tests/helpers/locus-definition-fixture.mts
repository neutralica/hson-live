import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import type { Locus, LocusRegistryOptions, LocusDefinitionOptions, LocusDefinitions, LocusLibraryDefinition, LocusPersistenceAdapter, LocusLocalLibraryDefinition } from "../../src/types/locus.core.types.ts";
import type { LocusActionPayloads } from "../../src/types/locus.protocol.types.ts";
import type { LibraryGroupDefinitions } from "../../src/types/library-evidence.types.ts";
import type { LiveMap, LiveMapDefinitions, LiveMapLibraryDefinition } from "../../src/types/livemap.types.ts";
import type { LocusLibraryCatalogEntry } from "../../src/types/locus.projection.types.ts";
import type { InteractionDescriptor } from "../../src/types/interaction.types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { node_to_json_value } from "../../src/api/livemap/livemap.editor.ts";
import { HsonSchema } from "../../src/api/schema/hson-schema.ts";
import { admit_public_livemap_definitions, make_livemap_libraries } from "../../src/api/livemap/livemap.libraries.ts";
import { create_registry_locus } from "../../src/api/locus/locus.registry.ts";
import { resume_registry_locus } from "../../src/api/locus/locus.registry.persistence.ts";
import { add_interaction, enable_interactions } from "../../src/api/interactions/interactions.ts";
import type { DocumentCssRecord } from "../../src/types/document-css.types.ts";
import { opaque_document_stylesheet } from "../../src/internal/css/opaque-stylesheet.ts";

// Transport fixtures reconstruct complete validated maps. This test-only proof
// does not confer guaranteed inventory on uncertain public construction input.
declare const fixtureInventory: unique symbol;
type FixtureInventory<TMap extends LiveMap> = { readonly [fixtureInventory]: TMap };
type FixtureOptions<TMap extends LiveMap, A extends LocusActionPayloads> =
  FixtureInventory<TMap> & { definitions: LocusDefinitions } &
  Omit<LocusDefinitionOptions, "actions" | "schema" | "authorizeAction"> &
  Omit<LocusRegistryOptions<TMap, A>, "map" | "libraries"> & FixtureCssCarrier;
const fixtureCss = Symbol("fixture CSS records");
type FixtureCssRecords = Readonly<Record<string, DocumentCssRecord>>;
type FixtureCssCarrier = { readonly [fixtureCss]?: FixtureCssRecords };
function registry_options<TMap extends LiveMap, A extends LocusActionPayloads>(options: FixtureOptions<TMap, A>): LocusRegistryOptions<TMap, A> {
  const { [fixtureCss]: _fixtureCss, definitions, local = [], interactions, ...configuration } = options;
  const admitted = admit_public_livemap_definitions(definitions, true);
  const css = Object.freeze({ ...admitted.css, ...options[fixtureCss] });
  const map = make_livemap_libraries(admitted.definitions, [], undefined, css);
  if (configuration.logicalMapId !== undefined || configuration.incarnationId !== undefined) {
    const aggregate = internal_livemap_aggregate_authority(map);
    const original = aggregate.hostedPosition().authority;
    aggregate.setInitialHostedAuthority(Object.freeze({
      logicalMapId: configuration.logicalMapId ?? original.logicalMapId,
      incarnationId: configuration.incarnationId ?? original.incarnationId,
    }));
  }
  if (interactions !== undefined) enable_interactions(map);
  for (const descriptor of interactions ?? []) add_interaction(map, descriptor);
  const libraries: LocusLibraryCatalogEntry[] = Object.entries(admitted.definitions).map(([name, definition]) => ({
    name, definition, ownership: admitted.ownership[name]!, ...(css[name] === undefined ? {} : { css: css[name] }),
  }));
  const names = new Set(Object.keys(admitted.definitions));
  for (const entry of local) {
    if (entry === undefined || !entry.name || names.has(entry.name)) throw new Error("Invalid or duplicated fixture local initializer.");
    names.add(entry.name);
    const localCss = options[fixtureCss]?.[entry.name]
      ?? (entry.stylesheet === undefined ? undefined : opaque_document_stylesheet(entry.stylesheet));
    libraries.push({ name: entry.name, ownership: "local", initializer: entry.initializer,
      ...(localCss === undefined ? {} : { css: localCss }) });
  }
  // The fixture inventory proves these reconstructed definitions are TMap's.
  // Keep that proof at the map boundary so actions and the registry share TMap.
  const typedMap = map as unknown as TMap;
  return { ...configuration, map: typedMap, libraries };
}
export function create_locus_fixture<TMap extends LiveMap, A extends LocusActionPayloads = LocusActionPayloads>(options: FixtureOptions<TMap, A>): Locus<TMap, A> {
  if (options[fixtureCss] !== undefined) return create_registry_locus(registry_options(options));
  const { definitions, ...configuration } = options;
  return hsonLiveMap.locus.create(definitions, configuration as LocusDefinitionOptions) as unknown as Locus<TMap, A>;
}
export function resume_locus_fixture<TMap extends LiveMap, A extends LocusActionPayloads = LocusActionPayloads>(options: FixtureOptions<TMap, A> & { logicalMapId: string; persistence: LocusPersistenceAdapter }): Promise<Locus<TMap, A>> {
  if (options[fixtureCss] !== undefined) {
    const { persistence, ...ordinary } = options;
    return resume_registry_locus({ ...registry_options(ordinary), persistence }, { scopedDocuments: "auto" });
  }
  const { definitions, ...configuration } = options;
  return hsonLiveMap.locus.resume(definitions, configuration as LocusDefinitionOptions & { logicalMapId: string; persistence: LocusPersistenceAdapter }) as unknown as Promise<Locus<TMap, A>>;
}

type CatalogMap<T extends readonly LocusLibraryCatalogEntry[]> = LiveMap<LibraryGroupDefinitions<{
  shared: { [K in keyof T]: T[K] extends { name: infer N extends string; definition: infer D extends LiveMapLibraryDefinition } ? { name: N; definition: D } : undefined };
}>>;
type DefinitionsOf<TMap> = TMap extends LiveMap<infer D> ? D : LiveMapDefinitions;
type FixtureDefinition<TMap extends LiveMap> = FixtureInventory<TMap> & FixtureCssCarrier & Readonly<{
  definitions: LocusDefinitions;
  local: readonly LocusLocalLibraryDefinition[];
  interactions?: readonly InteractionDescriptor[];
}>;
/** Recover flat authority definitions and separate client seeds from a transport fixture. */
export function authority_definitions_from_map_fixture<TMap extends LiveMap>(map: TMap, catalog: readonly LocusLibraryCatalogEntry[]): FixtureDefinition<TMap> {
  const checkpoint = internal_livemap_aggregate_authority(map).captureSemanticCheckpoint();
  const supplied = new Set(catalog.filter(entry => entry.ownership !== "local").map(entry => entry.name));
  if (checkpoint.registry.libraries.some(entry => entry.scope !== "hson-internal" && !supplied.has(entry.name))) {
    throw new Error("Complete-map fixture catalog omitted a Library.");
  }
  const definitions: Record<string, LocusLibraryDefinition> = Object.create(null);
  const local: LocusLocalLibraryDefinition[] = [];
  const css: Record<string, DocumentCssRecord> = Object.create(null);
  for (const entry of catalog) {
    if (entry.ownership === "local") {
      local.push({ name: entry.name, initializer: entry.initializer });
      if (entry.css !== undefined) css[entry.name] = entry.css;
      continue;
    }
    const index = checkpoint.registry.libraries.findIndex(candidate => candidate.name === entry.name);
    const registry = checkpoint.registry.libraries[index], state = checkpoint.libraries[index];
    if (registry === undefined || state === undefined) throw new Error(`Test fixture Library ${entry.name} is missing.`);
    const schema = HsonSchema.fromHson(registry.schema);
    const definition: LiveMapLibraryDefinition = registry.mode === "document"
      ? { document: state.root, schema }
      : (() => { const value = node_to_json_value(state.root); return { data: typeof value === "string" ? JSON.stringify(value) : value, schema }; })();
    definitions[entry.name] = { ...definition, access: entry.ownership };
    if (state.css !== undefined) css[entry.name] = state.css;
  }
  const system = checkpoint.registry.libraries.findIndex(entry => entry.scope === "hson-internal");
  let interactions: readonly InteractionDescriptor[] | undefined;
  if (system >= 0) {
    const root = checkpoint.libraries[system]?.root;
    const value = root === undefined ? undefined : node_to_json_value(root);
    const descriptors = typeof value === "object" && value !== null && !Array.isArray(value) ? value.descriptors : undefined;
    if (!Array.isArray(descriptors)) throw new Error("Test interaction fixture is malformed.");
    interactions = descriptors as unknown as InteractionDescriptor[];
  }
  return { definitions, local, ...(interactions === undefined ? {} : { interactions }), [fixtureCss]: css } as unknown as FixtureDefinition<TMap>;
}

export function authority_definitions_from_catalog_fixture<const T extends readonly LocusLibraryCatalogEntry[]>(catalog: T): FixtureDefinition<CatalogMap<T>> {
  const definitions: Record<string, LocusLibraryDefinition> = Object.create(null);
  const local: LocusLocalLibraryDefinition[] = [];
  const css: Record<string, DocumentCssRecord> = Object.create(null);
  for (const entry of catalog) {
    if (entry.ownership === "local") {
      local.push({ name: entry.name, initializer: entry.initializer });
      if (entry.css !== undefined) css[entry.name] = entry.css;
    } else if (entry.definition !== undefined) {
      const { stylesheet: _stylesheet, ...definition } = entry.definition;
      definitions[entry.name] = { ...definition, access: entry.ownership } as LocusLibraryDefinition;
      if (entry.css !== undefined) css[entry.name] = entry.css;
      else if (entry.definition.stylesheet !== undefined) definitions[entry.name] = { ...entry.definition, access: entry.ownership };
    }
    else throw new Error(`Test catalog ${entry.name} needs a definition.`);
  }
  return { definitions, local, [fixtureCss]: css } as unknown as FixtureDefinition<CatalogMap<T>>;
}

export function authority_definition_from_fixture_options<const T extends Readonly<{ map: unknown; libraries: readonly LocusLibraryCatalogEntry[] }>>(
  options: T,
): FixtureDefinition<LiveMap<DefinitionsOf<T["map"]>>> & Omit<T, "map" | "libraries"> {
  const { map, libraries, ...rest } = options;
  return { ...rest, ...authority_definitions_from_map_fixture(map as LiveMap, libraries) } as unknown as
    FixtureDefinition<LiveMap<DefinitionsOf<T["map"]>>> & Omit<T, "map" | "libraries">;
}
