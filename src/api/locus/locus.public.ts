import type { LiveMap, LiveMapDefinitions } from "../../types/livemap.types.js";
import type {
  Locus, LocusAuthorityLibraryDefinition, LocusLocalLibraryDefinition,
  LocusDefinitionOptions, LocusDefinitionNameCheck, LocusPartsEntriesCheck, LocusMapDefinitions, LocusRegistryOptions, LocusResumeOptions,
} from "../../types/locus.core.types.js";
import type { LocusActionPayloads } from "../../types/locus.protocol.types.js";
import type { LocusLibraryCatalogEntry } from "../../types/locus.projection.types.js";
import { make_livemap_libraries } from "../livemap/livemap.libraries.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { enable_interactions, add_interaction } from "../interactions/interactions.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { create_registry_locus } from "./locus.registry.js";
import { resume_registry_locus, checkpoint_registry_locus } from "./locus.registry.persistence.js";

export function construct_locus_definition<
  TPrivate extends readonly (LocusAuthorityLibraryDefinition | undefined)[],
  TShared extends readonly (LocusAuthorityLibraryDefinition | undefined)[],
  TLocal extends readonly (LocusLocalLibraryDefinition | undefined)[],
  TActions extends LocusActionPayloads,
  TGroups,
>(options: LocusDefinitionOptions<TPrivate, TShared, TLocal, TActions, TGroups>):
  LocusRegistryOptions<LiveMap<LocusMapDefinitions<TPrivate, TShared, TGroups>>, TActions> {
  if (typeof options !== "object" || options === null || Array.isArray(options)
    || "map" in options || "libraries" in options) throw new TypeError("Locus requires grouped library definitions.");
  const fields = ["private", "shared", "local", "interactions", "defaultProjection", "authorizeProjection",
    "actions", "logicalMapId", "incarnationId", "sessionId", "sessions", "actionDedupe", "schema",
    "authorizeAction", "persistence"];
  if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !fields.includes(key))) {
    throw new TypeError("Locus definition contains an unsupported field.");
  }
  const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
  const catalog: LocusLibraryCatalogEntry[] = [];
  const css: Record<string, import("../../types/document-css.types.js").DocumentCssRecord> = Object.create(null);
  const names = new Set<string>();
  const group = (entries: readonly (LocusAuthorityLibraryDefinition | LocusLocalLibraryDefinition | undefined)[] | undefined,
    ownership: "private" | "shared" | "local") => {
    if (entries === undefined) return;
    if (!Array.isArray(entries)) throw new TypeError("Locus library group must be an array.");
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !entry.name || names.has(entry.name)) {
        throw new TypeError("Locus application library catalog contains an invalid or duplicate name.");
      }
      const allowed = ownership === "local" ? ["name", "initializer", "css"] : ["name", "definition", "css"];
      if (Reflect.ownKeys(entry).some((key) => typeof key !== "string" || !allowed.includes(key))) {
        throw new TypeError("Locus library entry contains an unsupported field.");
      }
      names.add(entry.name);
      if (ownership === "local") {
        if (!("initializer" in entry) || entry.initializer === undefined || "definition" in entry) {
          throw new TypeError("Local Library requires an initializer.");
        }
        catalog.push({ name: entry.name, ownership, initializer: entry.initializer,
          ...(entry.css === undefined ? {} : { css: parse_document_stylesheet(entry.css, []) }) });
      } else {
        if (!("definition" in entry) || entry.definition === undefined || "initializer" in entry) {
          throw new TypeError("Authority Library requires a definition.");
        }
        definitions[entry.name] = entry.definition;
        if (entry.css !== undefined) {
          if (!("document" in entry.definition)) throw new TypeError("Initial CSS requires a document definition.");
          css[entry.name] = parse_document_stylesheet(entry.css, []);
        }
        catalog.push({ name: entry.name, ownership, definition: entry.definition,
          ...(entry.css === undefined ? {} : { css: css[entry.name] }) });
      }
    }
  };
  group(options.private, "private");
  group(options.shared, "shared");
  group(options.local, "local");
  for (const [name, input] of Object.entries(definitions)) {
    if ("document" in input && input.document !== undefined && typeof input.document !== "string") {
      admit_portable_hson_node(input.document, `Locus Library ${name}`);
    }
  }
  const map = make_livemap_libraries(definitions, [], undefined, css);
  if (options.logicalMapId !== undefined || options.incarnationId !== undefined) {
    const aggregate = internal_livemap_aggregate_authority(map);
    const original = aggregate.hostedPosition().authority;
    aggregate.setInitialHostedAuthority(Object.freeze({
      logicalMapId: options.logicalMapId ?? original.logicalMapId,
      incarnationId: options.incarnationId ?? original.incarnationId,
    }));
  }
  if (options.interactions !== undefined) enable_interactions(map);
  for (const descriptor of options.interactions ?? []) add_interaction(map, descriptor);
  const { private: _private, shared: _shared, local: _local, interactions: _interactions, ...rest } = options;
  const typedMap = map as unknown as LiveMap<LocusMapDefinitions<TPrivate, TShared, TGroups>>;
  return { ...rest, map: typedMap, libraries: catalog };
}

type AuthorityEntries = readonly (LocusAuthorityLibraryDefinition | undefined)[];
type LocalEntries = readonly (LocusLocalLibraryDefinition | undefined)[];
type ConstructionGroups<P, S, Required extends "private" | "shared"> =
  Partial<{ private: P; shared: S }> & Pick<{ private: P; shared: S }, Required>;
type ConstructionOptions<P extends AuthorityEntries, S extends AuthorityEntries, L extends LocalEntries,
  A extends LocusActionPayloads, Required extends "private" | "shared"> =
  LocusDefinitionOptions<P, S, L, A, ConstructionGroups<P, S, Required>> &
  ([Required] extends [never] ? unknown : Pick<ConstructionGroups<P, S, Required>, Required>) & LocusDefinitionNameCheck<P, S, L> & Readonly<{
    private?: LocusPartsEntriesCheck<NoInfer<P>>;
    shared?: LocusPartsEntriesCheck<NoInfer<S>>;
    local?: LocusPartsEntriesCheck<NoInfer<L>>;
  }>;
type ConstructedLocus<P extends AuthorityEntries, S extends AuthorityEntries, A extends LocusActionPayloads,
  Required extends "private" | "shared"> = Locus<LiveMap<LocusMapDefinitions<P, S, ConstructionGroups<P, S, Required>>>, A>;
type PersistenceOptions = Pick<LocusResumeOptions, "logicalMapId" | "persistence">;

// Presence overloads keep optional groups honest, including in contextually typed callbacks.
// Tuple membership and family/Schema inference still use the single shared evidence model.
/** Create a fresh authority from a Locus definition. */
export function create<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "private" | "shared">,
): ConstructedLocus<P, S, A, "private" | "shared">;
export function create<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "private">,
): ConstructedLocus<P, S, A, "private">;
export function create<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "shared">,
): ConstructedLocus<P, S, A, "shared">;
export function create<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, never>,
): ConstructedLocus<P, S, A, never>;
export function create(options: LocusDefinitionOptions): Locus {
  if ("persistence" in options) throw new TypeError("Use hsonLiveMap.locus.resume for durable authority.");
  return create_registry_locus(construct_locus_definition(options));
}

/** Restore a durable authority or establish the declared authority durably. */
export function resume<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "private" | "shared"> & PersistenceOptions,
): Promise<ConstructedLocus<P, S, A, "private" | "shared">>;
export function resume<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "private"> & PersistenceOptions,
): Promise<ConstructedLocus<P, S, A, "private">>;
export function resume<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, "shared"> & PersistenceOptions,
): Promise<ConstructedLocus<P, S, A, "shared">>;
export function resume<const P extends AuthorityEntries = readonly [], const S extends AuthorityEntries = readonly [],
  const L extends LocalEntries = readonly [], A extends LocusActionPayloads = LocusActionPayloads>(
  options: ConstructionOptions<P, S, L, A, never> & PersistenceOptions,
): Promise<ConstructedLocus<P, S, A, never>>;
export async function resume(options: LocusResumeOptions): Promise<Locus> {
  if (typeof options?.logicalMapId !== "string" || options.logicalMapId.trim().length === 0) {
    throw new TypeError("Locus resume requires a stable logicalMapId.");
  }
  if (options.persistence === undefined) throw new TypeError("Locus persistence adapter is required.");
  return resume_registry_locus({ ...construct_locus_definition(options), persistence: options.persistence }, { scopedDocuments: "auto" });
}

/** Compact a resumed Locus's already durable authority. */
export function checkpoint(locus: Locus): Promise<void> {
  return checkpoint_registry_locus(locus);
}
