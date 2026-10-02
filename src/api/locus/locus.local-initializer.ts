import type {
  LocusLibraryCatalogEntry,
  LocusLocalInitializer,
} from "../../types/locus.projection.types.js";
import type { LocusSessionNow } from "../../types/locus.core.types.js";
import type { LiveMap, LiveMapDefinitions, LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import { HsonSchema } from "../schema/hson-schema.js";
import {
  document_css_state_internal,
  reconstructed_data_internal,
  commit_document_css_internal,
  add_client_local_libraries_internal,
} from "../livemap/livemap.libraries.js";
import { hsonLiveMap } from "../livemap/livemap.facade.js";
import {
  decode_hosted_root,
  encode_hosted_root,
  hosted_sha256,
  HOSTED_MAX_SNAPSHOT_BYTES,
} from "../livemap/livemap.hosted.js";
import { classify_live_root_mode } from "../livemap/livemap.document.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { admit_authority_projection_snapshot } from "./locus.authority-projection-snapshot.js";
import {
  decode_portable_document_stylesheet,
  encode_portable_document_stylesheet,
  empty_portable_document_stylesheet,
  render_portable_document_stylesheet,
} from "../../internal/css/portable-document-stylesheet.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";

export type LocusApplicationCatalog = Readonly<{
  ownership: Map<string, "private" | "shared">;
  local: Map<string, LocusLocalInitializer>;
}>;

type LocalSeedContract = Readonly<Pick<LocusLocalInitializer, "mode" | "schemaDigest">>;
const clientLocalSeedContracts = new WeakMap<LiveMap, Map<string, LocalSeedContract>>();

function freeze_portable_value<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) freeze_portable_value(child);
  }
  return Object.freeze(value);
}

function canonical_local_css(input: unknown): import("../../types/document-css.types.js").DocumentCssRecord {
  const stylesheet = decode_portable_document_stylesheet(input);
  // A structured record must meet the same parser and RAWTEXT rules as authored CSS.
  parse_document_stylesheet(render_portable_document_stylesheet(stylesheet), []);
  return freeze_portable_value(encode_portable_document_stylesheet(stylesheet));
}

function initializer_fingerprint(input: Omit<LocusLocalInitializer, "fingerprint">): string {
  return hosted_sha256(JSON.stringify({ format: "hson-local-initializer", ...input }));
}

export function locus_local_initializer_digest(initializers: readonly LocusLocalInitializer[]): string {
  return hosted_sha256(JSON.stringify({
    format: "hson-local-initializer-set",
    initializers: initializers.map(({ name, fingerprint }) => ({ name, fingerprint })),
  }));
}

/** Admit the transport-neutral current composition produced by one retained session. */
export function admit_locus_session_now(input: unknown): LocusSessionNow {
  if (typeof input !== "object" || input === null || (input as { format?: unknown }).format !== "hson-locus-session-now") {
    throw new Error("Locus session now state is malformed.");
  }
  const value = input as { sessionBinding?: unknown; libs?: unknown; local?: unknown; initializerDigest?: unknown };
  if (typeof value.sessionBinding !== "string" || !/^[a-f0-9]{32}$/u.test(value.sessionBinding)) {
    throw new Error("Locus session now binding is malformed.");
  }
  const libs = admit_authority_projection_snapshot(value.libs);
  const local = admit_locus_local_initializers(value.local);
  const initializerDigest = locus_local_initializer_digest(local);
  if (value.initializerDigest !== initializerDigest) throw new Error("Locus session local initializer set is inconsistent.");
  return Object.freeze({ format: "hson-locus-session-now", sessionBinding: value.sessionBinding, libs, local, initializerDigest });
}

function canonical_local(entry: Extract<LocusLibraryCatalogEntry, { ownership: "local" }>): LocusLocalInitializer {
  const map = hsonLiveMap.fromLibraries(Object.freeze({ [entry.name]: entry.initializer }));
  const snapshot = map.capture();
  const library = snapshot.libraries[0];
  const registry = snapshot.registry.libraries[0];
  if (library === undefined || registry === undefined || library.name !== entry.name || registry.name !== entry.name) {
    throw new Error("Local initializer canonicalization lost its Library.");
  }
  const decoded = decode_hosted_root(library.root, HOSTED_MAX_SNAPSHOT_BYTES);
  admit_portable_hson_node(decoded, `Locus local initializer (${entry.name})`);
  const css = registry.mode === "document"
    ? entry.css === undefined
      ? canonical_local_css(encode_portable_document_stylesheet(empty_portable_document_stylesheet()))
      : canonical_local_css(entry.css)
    : undefined;
  if (registry.mode !== "document" && entry.css !== undefined) {
    throw new TypeError(`Locus local data initializer ${JSON.stringify(entry.name)} cannot define CSS.`);
  }
  const base = Object.freeze({
    name: entry.name,
    mode: registry.mode,
    schema: registry.schema,
    schemaDigest: registry.schemaDigest,
    rootCodec: "hson-exact-value" as const,
    root: encode_hosted_root(decoded),
    ...(css === undefined ? {} : { css }),
  });
  return Object.freeze({ ...base, fingerprint: initializer_fingerprint(base) });
}

/** Canonicalize and validate the complete deployment catalog. */
export function make_locus_application_catalog(
  map: LiveMap,
  entries: readonly LocusLibraryCatalogEntry[],
): LocusApplicationCatalog {
  if (!Array.isArray(entries)) throw new Error("Locus application library catalog is required.");
  const registry = internal_livemap_aggregate_authority(map).hostedRegistry();
  const authorityNames = new Set(registry.libraries
    .filter((entry) => entry.scope !== "hson-internal")
    .map((entry) => entry.name));
  const ownership = new Map<string, "private" | "shared">();
  const local = new Map<string, LocusLocalInitializer>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || entry.name.length === 0
      || seen.has(entry.name)) throw new Error("Locus application library catalog contains an invalid or duplicate name.");
    seen.add(entry.name);
    if (entry.ownership === "local") {
      if (authorityNames.has(entry.name)) throw new Error(`Local initializer ${JSON.stringify(entry.name)} collides with locus.map.`);
      local.set(entry.name, canonical_local(entry));
      continue;
    }
    if (entry.ownership !== "private" && entry.ownership !== "shared") {
      throw new Error(`Locus application library ${JSON.stringify(entry.name)} has invalid ownership.`);
    }
    if (!authorityNames.has(entry.name)) throw new Error("Locus application catalog names an unknown authority Library.");
    ownership.set(entry.name, entry.ownership);
  }
  for (const name of authorityNames) {
    if (!ownership.has(name)) throw new Error(`Locus application library catalog is missing ${JSON.stringify(name)}.`);
  }
  return Object.freeze({ ownership, local });
}

function exact_record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Local initializer is malformed.");
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new Error("Local initializer is malformed.");
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Local initializer is malformed.");
    output[key] = descriptor.value;
  }
  return output;
}

/** Structurally admit and convergence-check portable local definitions. */
export function admit_locus_local_initializers(input: unknown): readonly LocusLocalInitializer[] {
  if (!Array.isArray(input)) throw new Error("Local initializer set is malformed.");
  const names = new Set<string>();
  const admitted = input.map((candidate) => {
    const hasCss = typeof candidate === "object" && candidate !== null && Object.hasOwn(candidate, "css");
    const value = exact_record(candidate, ["name", "mode", "schema", "schemaDigest", "rootCodec", "root", ...(hasCss ? ["css"] : []), "fingerprint"]);
    if (typeof value.name !== "string" || value.name.length === 0 || names.has(value.name)
      || typeof value.schema !== "string" || typeof value.schemaDigest !== "string"
      || typeof value.fingerprint !== "string" || value.rootCodec !== "hson-exact-value") {
      throw new Error("Local initializer is malformed.");
    }
    names.add(value.name);
    const schema = HsonSchema.fromHson(value.schema);
    const schemaSource = schema.toHson();
    if (schemaSource !== value.schema || hosted_sha256(schemaSource) !== value.schemaDigest) {
      throw new Error("Local initializer Schema is noncanonical.");
    }
    const root = decode_hosted_root(value.root as { format: "hson-exact-value"; payload: string }, HOSTED_MAX_SNAPSHOT_BYTES);
    admit_portable_hson_node(root, `Locus local initializer (${value.name})`);
    const mode = classify_live_root_mode(root, value.mode === "document" ? "document" : "data");
    if (mode !== value.mode) throw new Error("Local initializer root mode is inconsistent.");
    validate_hson_schema_graph(schema, root);
    const css = mode === "document"
      ? canonical_local_css(value.css)
      : undefined;
    if (mode !== "document" && hasCss) throw new Error("Local data initializer cannot carry CSS.");
    const base = Object.freeze({
      name: value.name,
      mode,
      schema: schemaSource,
      schemaDigest: value.schemaDigest,
      rootCodec: "hson-exact-value" as const,
      root: encode_hosted_root(root),
      ...(css === undefined ? {} : { css }),
    });
    if (initializer_fingerprint(base) !== value.fingerprint) throw new Error("Local initializer fingerprint is inconsistent.");
    return Object.freeze({ ...base, fingerprint: value.fingerprint });
  }).sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze(admitted);
}

/** Retain the immutable definition identity independently of evolving client state. @internal */
export function retain_client_local_seed_contracts_internal(map: LiveMap, initializers: readonly LocusLocalInitializer[]): void {
  const contracts = clientLocalSeedContracts.get(map) ?? new Map<string, LocalSeedContract>();
  for (const initializer of initializers) {
    const prior = contracts.get(initializer.name);
    if (prior !== undefined && (prior.mode !== initializer.mode || prior.schemaDigest !== initializer.schemaDigest)) {
      throw new Error(`Local Library ${JSON.stringify(initializer.name)} already has a different seed contract.`);
    }
    contracts.set(initializer.name, Object.freeze({ mode: initializer.mode, schemaDigest: initializer.schemaDigest }));
  }
  clientLocalSeedContracts.set(map, contracts);
}

/** Initialize absent local Libraries; compatible existing client-owned state always wins. */
export function install_client_local_initializers_internal(
  map: LiveMap,
  input: readonly LocusLocalInitializer[],
): void {
  const initializers = admit_locus_local_initializers(input);
  const aggregate = internal_livemap_aggregate_authority(map);
  const projected = new Set(aggregate.clientProjection()?.libraries ?? []);
  const registry = aggregate.hostedRegistry();
  const seedContracts = clientLocalSeedContracts.get(map);
  const missing: LocusLocalInitializer[] = [];
  for (const initializer of initializers) {
    const existing = registry.libraries.find((entry) => entry.name === initializer.name);
    if (existing === undefined) {
      missing.push(initializer);
      continue;
    }
    if (projected.has(initializer.name)) throw new Error(`Local initializer ${JSON.stringify(initializer.name)} collides with shared state.`);
    const seed = seedContracts?.get(initializer.name);
    if (seed === undefined || existing.mode !== initializer.mode
      || seed.mode !== initializer.mode || seed.schemaDigest !== initializer.schemaDigest) {
      throw new Error(`Existing local Library ${JSON.stringify(initializer.name)} is incompatible with its authorized initializer.`);
    }
  }
  if (missing.length === 0) return;
  const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
  for (const initializer of missing) {
    const root = decode_hosted_root(initializer.root, HOSTED_MAX_SNAPSHOT_BYTES);
    const schema = HsonSchema.fromHson(initializer.schema);
    definitions[initializer.name] = initializer.mode === "document"
      ? { document: root, schema }
      : { data: reconstructed_data_internal(root), schema };
  }
  add_client_local_libraries_internal(map, Object.freeze(definitions));
  apply_client_local_initializer_css_internal(map, missing);
  retain_client_local_seed_contracts_internal(map, missing);
}

/** Apply canonical initial CSS while establishing newly created local documents. @internal */
export function apply_client_local_initializer_css_internal(
  map: LiveMap,
  initializers: readonly LocusLocalInitializer[],
): void {
  for (const initializer of initializers) {
    if (initializer.mode !== "document" || initializer.css === undefined) continue;
    const document = map.lib(initializer.name) as LiveMapDocumentLibrary;
    const stylesheet = decode_portable_document_stylesheet(initializer.css);
    if (JSON.stringify(stylesheet) === JSON.stringify(empty_portable_document_stylesheet())) continue;
    commit_document_css_internal(document, Object.freeze({
      domain: "css", kind: "append", stylesheet: encode_portable_document_stylesheet(stylesheet),
    }));
    // Read back through the canonical state owner before establishment continues.
    document_css_state_internal(document);
  }
}
