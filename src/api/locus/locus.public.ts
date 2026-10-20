import type { LiveMap, LiveMapKnownDefinitions, LiveMapDefinitionsCheck } from "../../types/livemap.types.js";
import type {
  Locus, LocusDefinitions, LocusLocalLibraryDefinition, LocusLocalNameCheck,
  LocusDefinitionOptions, LocusLocalEntriesCheck, LocusRegistryOptions, LocusResumeOptions,
} from "../../types/locus.core.types.js";
import type { LocusActionPayloads } from "../../types/locus.protocol.types.js";
import type { LocusLibraryCatalogEntry } from "../../types/locus.projection.types.js";
import { admit_public_livemap_definitions, make_livemap_libraries } from "../livemap/livemap.libraries.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { enable_interactions, add_interaction } from "../interactions/interactions.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { create_registry_locus } from "./locus.registry.js";
import { resume_registry_locus, checkpoint_registry_locus } from "./locus.registry.persistence.js";

type LocalEntries = readonly (LocusLocalLibraryDefinition | undefined)[];
type ConfigurationCheck<D, L> = LocusLocalNameCheck<D, L> & Readonly<{ local?: LocusLocalEntriesCheck<NoInfer<L>> }>;

/** Preserve owner configuration separately from all possible Library names. */
function capture_configuration<T extends object>(input: T, durable: boolean): T {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("Locus configuration must be an object.");
  const fields = ["local", "interactions", "defaultProjection", "authorizeProjection", "actions", "logicalMapId",
    "incarnationId", "sessionId", "sessions", "actionDedupe", "schema", "authorizeAction", ...(durable ? ["persistence"] : [])];
  const captured: T = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.includes(key)) throw new TypeError("Locus configuration contains an unsupported field.");
    Object.defineProperty(captured, key, { value: Reflect.get(input, key), enumerable: true });
  }
  return Object.freeze(captured);
}

/** Normalize construction into the existing registry owner. Admission has its own managed lifecycle. */
function construct_locus_definition<D extends LocusDefinitions, A extends LocusActionPayloads>(
  definitions: D, options: LocusDefinitionOptions<D, A>,
): LocusRegistryOptions<LiveMap<LiveMapKnownDefinitions<D>>, A> {
  const captured = admit_public_livemap_definitions(definitions, true);
  const catalog: LocusLibraryCatalogEntry[] = Object.entries(captured.definitions).map(([name, definition]) => ({
    name, definition, ownership: captured.ownership[name]!,
    ...(captured.css[name] === undefined ? {} : { css: captured.css[name] }),
  }));
  const names = new Set(Object.keys(captured.definitions));
  if (options.local !== undefined) {
    if (!Array.isArray(options.local)) throw new TypeError("Locus local initializers must be an array.");
    for (const entry of options.local) {
      if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !entry.name || names.has(entry.name)
        || entry.initializer === undefined || Reflect.ownKeys(entry).some(key => key !== "name" && key !== "initializer" && key !== "css")) {
        throw new TypeError("Locus local initializer is invalid or duplicated.");
      }
      names.add(entry.name);
      catalog.push({ name: entry.name, ownership: "local", initializer: entry.initializer,
        ...(entry.css === undefined ? {} : { css: parse_document_stylesheet(entry.css, []) }) });
    }
  }
  const map = make_livemap_libraries(captured.definitions, [], undefined, captured.css);
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
  const { local: _local, interactions: _interactions, ...rest } = options;
  const typedMap = map as unknown as LiveMap<LiveMapKnownDefinitions<D>>;
  return { ...rest, map: typedMap, libraries: catalog };
}

/** Establish initial authority from flat keyed definitions; omitted access is private. */
export function create<const D extends LocusDefinitions, A extends LocusActionPayloads = LocusActionPayloads,
  const L extends LocalEntries = readonly []>(
  definitions: D & LiveMapDefinitionsCheck<NoInfer<D>, "access">,
  configuration?: LocusDefinitionOptions<D, A, L> & ConfigurationCheck<NoInfer<D>, L>,
): Locus<LiveMap<LiveMapKnownDefinitions<D>>, A> {
  const options = capture_configuration<LocusDefinitionOptions<D, A, L>>(configuration === undefined ? {} : configuration, false);
  return create_registry_locus(construct_locus_definition<D, A>(definitions, options));
}

/** Restore a durable authority or establish the declared initial authority durably. */
export async function resume<const D extends LocusDefinitions, A extends LocusActionPayloads = LocusActionPayloads,
  const L extends LocalEntries = readonly []>(
  definitions: D & LiveMapDefinitionsCheck<NoInfer<D>, "access">,
  configuration: LocusResumeOptions<D, A, L> & ConfigurationCheck<NoInfer<D>, L>,
): Promise<Locus<LiveMap<LiveMapKnownDefinitions<D>>, A>> {
  const options = capture_configuration(configuration, true);
  if (typeof options.logicalMapId !== "string" || options.logicalMapId.trim().length === 0) {
    throw new TypeError("Locus resume requires a stable logicalMapId.");
  }
  if (options.persistence === undefined) throw new TypeError("Locus persistence adapter is required.");
  return resume_registry_locus({ ...construct_locus_definition<D, A>(definitions, options), persistence: options.persistence }, { scopedDocuments: "auto" });
}

/** Compact a resumed Locus's already durable authority. */
export function checkpoint(locus: Locus): Promise<void> {
  return checkpoint_registry_locus(locus);
}
