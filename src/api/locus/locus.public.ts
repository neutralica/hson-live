import type { LiveMap, LiveMapDefinitions } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads, Locus, LocusOptions, LocusOwnedLibraryCatalogEntry,
  LocusOwnedMapDefinitions, LocusOwnedOptions, PersistentLocus,
  PersistentLocusOptions, PersistentLocusOwnedOptions,
} from "../../types/locus.types.js";
import { hsonLiveMap } from "../livemap/livemap.facade.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { commit_document_css_internal, is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import { create_registry_locus } from "./locus.registry.js";
import { create_persistent_registry_locus } from "./locus.registry.persistence.js";

function owned_map(libraries: readonly LocusOwnedLibraryCatalogEntry[],
  logicalMapId?: string, incarnationId?: string): LiveMap {
  if (!Array.isArray(libraries)) throw new TypeError("Locus requires an application library catalog.");
  const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
  const css: { name: string; stylesheet: import("../../types/document-css.types.js").DocumentCssRecord }[] = [];
  const names = new Set<string>();
  for (const entry of libraries) {
    if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !entry.name
      || names.has(entry.name)) throw new TypeError("Locus application library catalog contains an invalid or duplicate name.");
    names.add(entry.name);
    if (entry.ownership === "local") {
      if ("definition" in entry) throw new TypeError("Local initializer cannot define authority state.");
      continue;
    }
    if ((entry.ownership !== "private" && entry.ownership !== "shared") || entry.definition === undefined) {
      throw new TypeError("Locus-owned authority libraries require a definition and private/shared ownership.");
    }
    if ("initializer" in entry) throw new TypeError("Authority library cannot carry a local initializer.");
    definitions[entry.name] = entry.definition;
    if (entry.css !== undefined) {
      if (!("document" in entry.definition)) throw new TypeError("Initial CSS requires a document definition.");
      css.push({ name: entry.name, stylesheet: encode_portable_document_stylesheet(
        decode_portable_document_stylesheet(entry.css)) });
    }
  }
  const map = hsonLiveMap.fromLibraries(definitions);
  if (logicalMapId !== undefined || incarnationId !== undefined) {
    const aggregate = internal_livemap_aggregate_authority(map);
    const original = aggregate.hostedPosition().authority;
    aggregate.setInitialHostedAuthority(Object.freeze({
      logicalMapId: logicalMapId ?? original.logicalMapId,
      incarnationId: incarnationId ?? original.incarnationId,
    }));
  }
  for (const entry of css) {
    const library = map.lib(entry.name);
    if (library.mode !== "document") throw new TypeError("Initial CSS requires a document library.");
    if (entry.stylesheet.order.length > 0) commit_document_css_internal(library, {
      domain: "css", kind: "append", stylesheet: entry.stylesheet,
    });
  }
  return map;
}

/** Construct an authority from one application catalog, or adopt an existing map. */
export function create<const TCatalog extends readonly LocusOwnedLibraryCatalogEntry[],
  TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: PersistentLocusOwnedOptions<TCatalog, TActions>,
): Promise<PersistentLocus<LiveMap<LocusOwnedMapDefinitions<TCatalog>>, TActions>>;
export function create<TMap extends LiveMap, TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: PersistentLocusOptions<TMap, TActions>,
): Promise<PersistentLocus<TMap, TActions>>;
export function create<const TCatalog extends readonly LocusOwnedLibraryCatalogEntry[],
  TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: LocusOwnedOptions<TCatalog, TActions>,
): Locus<LiveMap<LocusOwnedMapDefinitions<TCatalog>>, TActions>;
export function create<TMap extends LiveMap, TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: LocusOptions<TMap, TActions>,
): Locus<TMap, TActions>;
export function create(options: LocusOptions<LiveMap> | LocusOwnedOptions<readonly LocusOwnedLibraryCatalogEntry[]>
  | PersistentLocusOptions<LiveMap> | PersistentLocusOwnedOptions<readonly LocusOwnedLibraryCatalogEntry[]>):
  Locus<LiveMap> | Promise<PersistentLocus<LiveMap>> {
  if (typeof options !== "object" || options === null) throw new TypeError("Locus options are required.");
  const map = "map" in options && options.map !== undefined ? options.map
    : owned_map(options.libraries, options.logicalMapId, options.incarnationId);
  if (!is_public_multi_library_livemap(map)) throw new TypeError("Locus requires a LiveMap.");
  if ("map" in options && options.map !== undefined && Array.isArray(options.libraries)
    && options.libraries.some((entry) => entry.ownership !== "local"
      && ("definition" in entry || "css" in entry))) {
    throw new TypeError("An adopted map already owns its authority definitions and CSS.");
  }
  const configured = { ...options, map };
  if ("persistence" in configured) {
    if (configured.persistence === undefined) throw new TypeError("Locus persistence adapter is required.");
    return create_persistent_registry_locus(configured);
  }
  return create_registry_locus(configured);
}
