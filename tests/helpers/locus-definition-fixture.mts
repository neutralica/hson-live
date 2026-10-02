import type { LiveMap, LiveMapDefinitions, LiveMapLibraryDefinition } from "../../src/types/livemap.types.ts";
import type { LocusAuthorityLibraryDefinition, LocusLocalLibraryDefinition } from "../../src/types/locus.core.types.ts";
import type { LocusLibraryCatalogEntry } from "../../src/types/locus.projection.types.ts";
import type { InteractionDescriptor } from "../../src/types/interaction.types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { node_to_json_value } from "../../src/api/livemap/livemap.editor.ts";
import { HsonSchema } from "../../src/api/schema/hson-schema.ts";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";

const css_text = (input: import("../../src/types/document-css.types.ts").DocumentCssRecord): string =>
  render_portable_document_stylesheet(decode_portable_document_stylesheet(input));

type DefinitionsOf<TMap> = TMap extends LiveMap<infer TDefinitions> ? TDefinitions : LiveMapDefinitions;
type AuthorityEntries<TDefinitions extends LiveMapDefinitions, TName extends string> =
  ReadonlyArray<{ [TKey in TName & keyof TDefinitions]-?: Readonly<{ name: TKey; definition: NonNullable<TDefinitions[TKey]> }> }[TName & keyof TDefinitions]>;
type LocalEntries<TCatalog extends readonly LocusLibraryCatalogEntry[]> =
  ReadonlyArray<Extract<TCatalog[number], { ownership: "local" }> extends infer TEntry
    ? TEntry extends { name: string; initializer: LiveMapLibraryDefinition }
      ? Readonly<{ name: TEntry["name"]; initializer: TEntry["initializer"] }>
      : LocusLocalLibraryDefinition
    : never>;
type CatalogAuthorityEntry<TCatalog extends readonly LocusLibraryCatalogEntry[]> =
  TCatalog[number] extends infer TEntry
    ? TEntry extends { name: string; definition: LiveMapLibraryDefinition }
      ? Readonly<{ name: TEntry["name"]; definition: TEntry["definition"] }>
      : never
    : never;

/** Turn a test map's semantic fixture state into explicit Locus construction groups. */
export function authority_groups_from_map_fixture<
  TMap extends LiveMap,
  const TCatalog extends readonly LocusLibraryCatalogEntry[],
>(map: TMap, catalog: TCatalog): Readonly<{
  private: AuthorityEntries<DefinitionsOf<TMap>, keyof DefinitionsOf<TMap> & string>;
  shared: AuthorityEntries<DefinitionsOf<TMap>, keyof DefinitionsOf<TMap> & string>;
  local: LocalEntries<TCatalog>;
  interactions?: readonly InteractionDescriptor[];
}> {
  const checkpoint = internal_livemap_aggregate_authority(map).captureSemanticCheckpoint();
  const privateEntries: LocusAuthorityLibraryDefinition[] = [];
  const sharedEntries: LocusAuthorityLibraryDefinition[] = [];
  const localEntries: LocusLocalLibraryDefinition[] = [];
  for (const entry of catalog) {
    if (entry.ownership === "local") {
      localEntries.push({ name: entry.name, initializer: entry.initializer,
        ...(entry.css === undefined ? {} : { css: css_text(entry.css) }) } as LocusLocalLibraryDefinition);
      continue;
    }
    const index = checkpoint.registry.libraries.findIndex((candidate) => candidate.name === entry.name);
    const registry = checkpoint.registry.libraries[index];
    const state = checkpoint.libraries[index];
    if (registry === undefined || state === undefined) throw new Error(`Test fixture Library ${entry.name} is missing.`);
    const schema = HsonSchema.fromHson(registry.schema);
    const definition: LiveMapLibraryDefinition = registry.mode === "document"
      ? { document: state.root, schema }
      : (() => { const value = node_to_json_value(state.root); return { data: typeof value === "string" ? JSON.stringify(value) : value, schema }; })();
    const output = { name: entry.name, definition,
      ...(state.css === undefined ? {} : { css: css_text(state.css) }) } as LocusAuthorityLibraryDefinition;
    if (entry.ownership === "private") privateEntries.push(output);
    else sharedEntries.push(output);
  }
  const system = checkpoint.registry.libraries.findIndex((entry) => entry.scope === "hson-internal");
  let interactions: readonly InteractionDescriptor[] | undefined;
  if (system >= 0) {
    const root = checkpoint.libraries[system]?.root;
    const value = root === undefined ? undefined : node_to_json_value(root);
    const descriptors = typeof value === "object" && value !== null && !Array.isArray(value)
      ? value.descriptors : undefined;
    if (!Array.isArray(descriptors)) throw new Error("Test interaction fixture is malformed.");
    interactions = descriptors as unknown as InteractionDescriptor[];
  }
  return {
    private: privateEntries,
    shared: sharedEntries,
    local: localEntries,
    ...(interactions === undefined ? {} : { interactions }),
  } as unknown as Readonly<{
    private: AuthorityEntries<DefinitionsOf<TMap>, keyof DefinitionsOf<TMap> & string>;
    shared: AuthorityEntries<DefinitionsOf<TMap>, keyof DefinitionsOf<TMap> & string>;
    local: LocalEntries<TCatalog>;
    interactions?: readonly InteractionDescriptor[];
  }>;
}

export function authority_groups_from_catalog_fixture<const TCatalog extends readonly LocusLibraryCatalogEntry[]>(catalog: TCatalog): Readonly<{
  private: readonly CatalogAuthorityEntry<TCatalog>[];
  shared: readonly CatalogAuthorityEntry<TCatalog>[];
  local: LocalEntries<TCatalog>;
}> {
  const privateEntries: LocusAuthorityLibraryDefinition[] = [];
  const sharedEntries: LocusAuthorityLibraryDefinition[] = [];
  const localEntries: LocusLocalLibraryDefinition[] = [];
  for (const entry of catalog) {
    if (entry.ownership === "local") localEntries.push({ name: entry.name, initializer: entry.initializer,
      ...(entry.css === undefined ? {} : { css: css_text(entry.css) }) } as LocusLocalLibraryDefinition);
    else if (entry.definition !== undefined) (entry.ownership === "private" ? privateEntries : sharedEntries).push({
      name: entry.name, definition: entry.definition, ...(entry.css === undefined ? {} : { css: css_text(entry.css) }),
    } as LocusAuthorityLibraryDefinition);
    else throw new Error(`Test catalog ${entry.name} needs a definition.`);
  }
  return { private: privateEntries, shared: sharedEntries, local: localEntries } as unknown as Readonly<{
    private: readonly CatalogAuthorityEntry<TCatalog>[];
    shared: readonly CatalogAuthorityEntry<TCatalog>[];
    local: LocalEntries<TCatalog>;
  }>;
}

/** Keep unrelated transport fixtures concise while their source map is expressed as grouped Locus definitions. */
export function authority_definition_from_fixture_options<
  const TOptions extends Readonly<{ map: unknown; libraries: readonly LocusLibraryCatalogEntry[] }>,
>(options: TOptions): Omit<TOptions, "map" | "libraries"> & Readonly<{
  private: AuthorityEntries<DefinitionsOf<TOptions["map"]>, keyof DefinitionsOf<TOptions["map"]> & string>;
  shared: AuthorityEntries<DefinitionsOf<TOptions["map"]>, keyof DefinitionsOf<TOptions["map"]> & string>;
  local: LocalEntries<TOptions["libraries"]>;
  interactions?: readonly InteractionDescriptor[];
}> {
  const { map, libraries, ...rest } = options;
  return { ...rest, ...authority_groups_from_map_fixture(map as LiveMap, libraries) } as unknown as
    Omit<TOptions, "map" | "libraries"> & Readonly<{
      private: AuthorityEntries<DefinitionsOf<TOptions["map"]>, keyof DefinitionsOf<TOptions["map"]> & string>;
      shared: AuthorityEntries<DefinitionsOf<TOptions["map"]>, keyof DefinitionsOf<TOptions["map"]> & string>;
      local: LocalEntries<TOptions["libraries"]>;
      interactions?: readonly InteractionDescriptor[];
    }>;
}
