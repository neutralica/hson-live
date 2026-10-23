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
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";

// Transport fixtures reconstruct complete validated maps. This test-only proof
// does not confer guaranteed inventory on uncertain public construction input.
declare const fixtureInventory: unique symbol;
type FixtureInventory<TMap extends LiveMap> = { readonly [fixtureInventory]: TMap };
type FixtureOptions<TMap extends LiveMap, A extends LocusActionPayloads> =
  FixtureInventory<TMap> & { definitions: LocusDefinitions } &
  Omit<LocusDefinitionOptions, "actions" | "schema" | "authorizeAction"> &
  Omit<LocusRegistryOptions<TMap, A>, "map" | "libraries">;
export function create_locus_fixture<TMap extends LiveMap, A extends LocusActionPayloads = LocusActionPayloads>(options: FixtureOptions<TMap, A>): Locus<TMap, A> {
  const { definitions, ...configuration } = options;
  return hsonLiveMap.locus.create(definitions, configuration as LocusDefinitionOptions) as unknown as Locus<TMap, A>;
}
export function resume_locus_fixture<TMap extends LiveMap, A extends LocusActionPayloads = LocusActionPayloads>(options: FixtureOptions<TMap, A> & { logicalMapId: string; persistence: LocusPersistenceAdapter }): Promise<Locus<TMap, A>> {
  const { definitions, ...configuration } = options;
  return hsonLiveMap.locus.resume(definitions, configuration as LocusDefinitionOptions & { logicalMapId: string; persistence: LocusPersistenceAdapter }) as unknown as Promise<Locus<TMap, A>>;
}

type CatalogMap<T extends readonly LocusLibraryCatalogEntry[]> = LiveMap<LibraryGroupDefinitions<{
  shared: { [K in keyof T]: T[K] extends { name: infer N extends string; definition: infer D extends LiveMapLibraryDefinition } ? { name: N; definition: D } : undefined };
}>>;
type DefinitionsOf<TMap> = TMap extends LiveMap<infer D> ? D : LiveMapDefinitions;
type FixtureDefinition<TMap extends LiveMap> = FixtureInventory<TMap> & Readonly<{
  definitions: LocusDefinitions;
  local: readonly LocusLocalLibraryDefinition[];
  interactions?: readonly InteractionDescriptor[];
}>;
const css_text = (input: import("../../src/types/document-css.types.ts").DocumentCssRecord): string =>
  render_portable_document_stylesheet(decode_portable_document_stylesheet(input));

/** Recover flat authority definitions and separate client seeds from a transport fixture. */
export function authority_definitions_from_map_fixture<TMap extends LiveMap>(map: TMap, catalog: readonly LocusLibraryCatalogEntry[]): FixtureDefinition<TMap> {
  const checkpoint = internal_livemap_aggregate_authority(map).captureSemanticCheckpoint();
  const supplied = new Set(catalog.filter(entry => entry.ownership !== "local").map(entry => entry.name));
  if (checkpoint.registry.libraries.some(entry => entry.scope !== "hson-internal" && !supplied.has(entry.name))) {
    throw new Error("Complete-map fixture catalog omitted a Library.");
  }
  const definitions: Record<string, LocusLibraryDefinition> = Object.create(null);
  const local: LocusLocalLibraryDefinition[] = [];
  for (const entry of catalog) {
    if (entry.ownership === "local") {
      local.push({ name: entry.name, initializer: entry.initializer,
        ...(entry.css === undefined ? {} : { stylesheet: css_text(entry.css) }) } as LocusLocalLibraryDefinition);
      continue;
    }
    const index = checkpoint.registry.libraries.findIndex(candidate => candidate.name === entry.name);
    const registry = checkpoint.registry.libraries[index], state = checkpoint.libraries[index];
    if (registry === undefined || state === undefined) throw new Error(`Test fixture Library ${entry.name} is missing.`);
    const schema = HsonSchema.fromHson(registry.schema);
    const definition: LiveMapLibraryDefinition = registry.mode === "document"
      ? { document: state.root, schema, ...(state.css === undefined ? {} : { stylesheet: css_text(state.css) }) }
      : (() => { const value = node_to_json_value(state.root); return { data: typeof value === "string" ? JSON.stringify(value) : value, schema }; })();
    definitions[entry.name] = { ...definition, access: entry.ownership };
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
  return { definitions, local, ...(interactions === undefined ? {} : { interactions }) } as unknown as FixtureDefinition<TMap>;
}

export function authority_definitions_from_catalog_fixture<const T extends readonly LocusLibraryCatalogEntry[]>(catalog: T): FixtureDefinition<CatalogMap<T>> {
  const definitions: Record<string, LocusLibraryDefinition> = Object.create(null);
  const local: LocusLocalLibraryDefinition[] = [];
  for (const entry of catalog) {
    if (entry.ownership === "local") local.push({ name: entry.name, initializer: entry.initializer,
      ...(entry.css === undefined ? {} : { stylesheet: css_text(entry.css) }) } as LocusLocalLibraryDefinition);
    else if (entry.definition !== undefined) definitions[entry.name] = { ...entry.definition, access: entry.ownership,
      ...(entry.css === undefined ? {} : { stylesheet: css_text(entry.css) }) } as LocusLibraryDefinition;
    else throw new Error(`Test catalog ${entry.name} needs a definition.`);
  }
  return { definitions, local } as unknown as FixtureDefinition<CatalogMap<T>>;
}

export function authority_definition_from_fixture_options<const T extends Readonly<{ map: unknown; libraries: readonly LocusLibraryCatalogEntry[] }>>(
  options: T,
): FixtureDefinition<LiveMap<DefinitionsOf<T["map"]>>> & Omit<T, "map" | "libraries"> {
  const { map, libraries, ...rest } = options;
  return { ...rest, ...authority_definitions_from_map_fixture(map as LiveMap, libraries) } as unknown as
    FixtureDefinition<LiveMap<DefinitionsOf<T["map"]>>> & Omit<T, "map" | "libraries">;
}
