import type {
  LocusConnectionContext,
  LocusLibraryCatalogEntry,
  LocusLocalInitializer,
  LocusProjectionAuthorization,
  LocusProjectionAuthorizer,
  LocusProjectionSystemFeature,
  LocusRequestedProjection,
} from "../../types/locus.types.js";
import type { HostedAuthorityFence, HostedRegistry, HostedRegistryEntry } from "../livemap/livemap.hosted.js";
import { hosted_sha256 } from "../livemap/livemap.hosted.js";
import { HsonSchema } from "../schema/hson-schema.js";
import { locus_local_initializer_digest, make_locus_application_catalog, type LocusApplicationCatalog } from "./locus.local-initializer.js";
import type { LiveMap } from "../../types/livemap.types.js";

/** Nominal hosted client egress is governed by the stored session projection. */
export const HOSTED_PROJECTION_EGRESS_COMPLETE = true;

export class LocusProjectionUnavailableError extends Error {
  readonly code = "LOCUS_PROJECTION_UNAVAILABLE";
  constructor() {
    super("Requested client projection is unavailable.");
    this.name = "LocusProjectionUnavailableError";
  }
}

export type LocusProjectedLibraryContract = Readonly<Pick<HostedRegistryEntry, "name" | "mode" | "schema" | "schemaDigest" | "rootCodec">>;

/** This object contains only included client contract data; it never carries policy or hidden names. */
export type LocusEffectiveProjection = Readonly<{
  authority: HostedAuthorityFence;
  libraries: readonly LocusProjectedLibraryContract[];
  local: readonly LocusLocalInitializer[];
  initializerDigest: string;
  compositionDigest: string;
  systemFeatures: readonly LocusProjectionSystemFeature[];
  writableDocuments: readonly string[];
  digest: string;
  includesLibrary: (name: string) => boolean;
  includesLocal: (name: string) => boolean;
  canAuthorDocument: (name: string) => boolean;
  hasSystemFeature: (feature: LocusProjectionSystemFeature) => boolean;
}>;

export type LocusHostedProjectionPolicy = Readonly<{
  registry: HostedRegistry;
  authority: HostedAuthorityFence;
  ownership: ReadonlyMap<string, "private" | "shared">;
  local: ReadonlyMap<string, LocusLocalInitializer>;
  defaultProjection?: LocusRequestedProjection;
  authorizeProjection?: LocusProjectionAuthorizer;
  /** Install a prevalidated hosted batch before the authority publishes it. @internal */
  installRuntimeOwnership: (entries: readonly Readonly<{ name: string; ownership: "private" | "shared" }>[], registry: HostedRegistry) => void;
}>;

/** Validate deployment policy against the restored/current application registry. */
export function make_locus_hosted_projection_policy(
  registry: HostedRegistry,
  authority: HostedAuthorityFence,
  libraryEntries: readonly LocusLibraryCatalogEntry[],
  defaultProjection?: LocusRequestedProjection,
  authorizeProjection?: LocusProjectionAuthorizer,
  map?: LiveMap,
): LocusHostedProjectionPolicy {
  const catalog = map === undefined ? (() => {
    if (!Array.isArray(libraryEntries) || libraryEntries.some((entry) => entry.ownership === "local")) {
      throw new Error("Local initializer catalog validation requires its Locus map.");
    }
    const application = new Set(registry.libraries.filter((entry) => entry.scope !== "hson-internal").map((entry) => entry.name));
    const ownership = new Map<string, "private" | "shared">();
    for (const entry of libraryEntries) {
      if (typeof entry !== "object" || entry === null || typeof entry.name !== "string"
        || !application.has(entry.name) || ownership.has(entry.name)
        || (entry.ownership !== "private" && entry.ownership !== "shared")) {
        throw new Error("Locus application library catalog is invalid.");
      }
      ownership.set(entry.name, entry.ownership);
    }
    for (const name of application) if (!ownership.has(name)) throw new Error(`Locus application library catalog is missing ${JSON.stringify(name)}.`);
    return Object.freeze({ ownership, local: new Map<string, LocusLocalInitializer>() });
  })() : make_locus_application_catalog(map, libraryEntries);
  if (authorizeProjection !== undefined && typeof authorizeProjection !== "function") {
    throw new Error("Hosted Locus projection authorizer must be a function.");
  }
  if (defaultProjection !== undefined) normalize_request(defaultProjection);
  let currentRegistry = registry;
  return Object.freeze({ get registry() { return currentRegistry; }, authority: Object.freeze({ ...authority }),
    ownership: catalog.ownership, local: catalog.local,
    ...(defaultProjection === undefined ? {} : { defaultProjection: normalize_request(defaultProjection) }),
    ...(authorizeProjection === undefined ? {} : { authorizeProjection }),
    installRuntimeOwnership(entries, nextRegistry: HostedRegistry) {
      // The caller validates the entire policy before admission. This install
      // runs in the prepared transition's publication boundary and cannot fail.
      for (const entry of entries) catalog.ownership.set(entry.name, entry.ownership);
      currentRegistry = nextRegistry;
    },
  });
}

/** Validate a complete per-library hosted classification before durable acceptance. */
export function runtime_locus_ownership_entries(
  names: readonly string[],
  values: Readonly<Record<string, "private" | "shared">> | undefined,
): readonly Readonly<{ name: string; ownership: "private" | "shared" }>[] {
  const requested = values ?? {};
  if (typeof requested !== "object" || requested === null || Array.isArray(requested)) {
    throw new Error("Hosted ownership must be a per-Library record.");
  }
  const candidates = new Set(names);
  const explicit = new Map<string, "private" | "shared">();
  for (const name of Reflect.ownKeys(requested)) {
    if (typeof name !== "string") throw new Error("Hosted ownership contains an invalid Library name.");
    if (!candidates.has(name)) throw new Error(`Hosted ownership names an unknown Library ${JSON.stringify(name)}.`);
    const descriptor = Object.getOwnPropertyDescriptor(requested, name);
    if (descriptor === undefined || !("value" in descriptor)
      || (descriptor.value !== "private" && descriptor.value !== "shared")) {
      throw new Error(`Hosted ownership is invalid for ${JSON.stringify(name)}.`);
    }
    explicit.set(name, descriptor.value);
  }
  return Object.freeze(names.map((name) => {
    const ownership = explicit.get(name) ?? "private";
    return Object.freeze({ name, ownership });
  }));
}

const EMPTY_REQUEST: LocusRequestedProjection = Object.freeze({ libraries: Object.freeze([]) });
const EMPTY_GRANT: LocusProjectionAuthorization = Object.freeze({});

function normalize_names(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new LocusProjectionUnavailableError();
  }
  return Object.freeze([...new Set(input)].sort());
}

function normalize_features(input: unknown): readonly LocusProjectionSystemFeature[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.some((feature) => feature !== "interactions")) {
    throw new LocusProjectionUnavailableError();
  }
  return Object.freeze([...new Set(input)].sort());
}

function normalize_request(input: LocusRequestedProjection): LocusRequestedProjection {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Reflect.ownKeys(input).some(key => key !== "libraries" && key !== "systemFeatures")) {
    throw new LocusProjectionUnavailableError();
  }
  const libraries = normalize_names(input.libraries);
  return Object.freeze({
    libraries,
    systemFeatures: normalize_features(input.systemFeatures),
  });
}

/** Freeze a caller's requested scope before it enters queued authorization. @internal */
export function snapshot_locus_requested_projection(input: LocusRequestedProjection): LocusRequestedProjection {
  return normalize_request(input);
}

function authorized_names(input: unknown): ReadonlySet<string> { return new Set(normalize_names(input ?? [])); }

/** Called before session creation; no session exists if normalization or authorization fails. */
export function normalize_locus_effective_projection(
  policy: LocusHostedProjectionPolicy,
  request: LocusRequestedProjection | undefined,
  connection?: LocusConnectionContext,
): LocusEffectiveProjection | Promise<LocusEffectiveProjection> {
  const requested = normalize_request(request ?? policy.defaultProjection ?? EMPTY_REQUEST);
  const decision = policy.authorizeProjection === undefined || (requested.libraries.length === 0 && (requested.systemFeatures?.length ?? 0) === 0)
    ? EMPTY_GRANT
    : policy.authorizeProjection(Object.freeze({ requested, ...policy.authority,
      ...(connection === undefined ? {} : { connection }),
    }));
  if (decision instanceof Promise) return decision.then((grant) => materialize_effective_projection(policy, requested, grant));
  return materialize_effective_projection(policy, requested, decision);
}

function materialize_effective_projection(
  policy: LocusHostedProjectionPolicy,
  requested: LocusRequestedProjection,
  grant: LocusProjectionAuthorization,
): LocusEffectiveProjection {
  if (typeof grant !== "object" || grant === null) throw new LocusProjectionUnavailableError();
  const allowed = authorized_names(grant.libraries);
  const allowedFeatures = new Set(normalize_features(grant.systemFeatures));
  const allowedWritable = authorized_names(grant.writableDocuments);
  const requestedNames = new Set(requested.libraries);
  const included = policy.registry.libraries
    .filter((entry) => entry.scope !== "hson-internal"
      && requestedNames.has(entry.name)
      && policy.ownership.get(entry.name) === "shared"
      && allowed.has(entry.name))
    .map((entry): LocusProjectedLibraryContract => {
      // Reconstruct the included Schema from its own source. No library resolver or
      // excluded registry entry participates in the client contract.
      try {
        if (hosted_sha256(entry.schema) !== entry.schemaDigest
          || HsonSchema.fromHson(entry.schema).toHson() !== entry.schema) throw new Error("Schema contract differs.");
      } catch {
        throw new LocusProjectionUnavailableError();
      }
      return Object.freeze({
        name: entry.name, mode: entry.mode, schema: entry.schema, schemaDigest: entry.schemaDigest, rootCodec: entry.rootCodec,
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const includedNames = new Set(included.map((entry) => entry.name));
  const local = Object.freeze([...policy.local.values()]
    .filter((entry) => requestedNames.has(entry.name) && allowed.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name)));
  const localNames = new Set(local.map((entry) => entry.name));
  const initializerDigest = locus_local_initializer_digest(local);
  const features = Object.freeze((requested.systemFeatures ?? []).filter((feature) => allowedFeatures.has(feature)
    && (feature !== "interactions" || policy.registry.libraries.some((entry) => entry.scope === "hson-internal"))));
  const writable = Object.freeze(included.filter((entry) => entry.mode === "document" && allowedWritable.has(entry.name)).map((entry) => entry.name));
  const authority = Object.freeze({ ...policy.authority });
  // The canonical digest input has no root, revision, policy, or excluded registry topology.
  const digest = locus_projection_contract_digest(authority, included, features, writable);
  const compositionDigest = hosted_sha256(JSON.stringify({ format: "locus-session-composition", digest, initializerDigest }));
  return Object.freeze({ authority, libraries: Object.freeze(included), local, initializerDigest, compositionDigest,
    systemFeatures: features, writableDocuments: writable, digest,
    includesLibrary: (name: string) => includedNames.has(name),
    includesLocal: (name: string) => localNames.has(name),
    canAuthorDocument: (name: string) => writable.includes(name),
    hasSystemFeature: (feature: LocusProjectionSystemFeature) => features.includes(feature),
  });
}

/** The Step 6A digest definition, also used to admit a decoded Step 6B contract. @internal */
export function locus_projection_contract_digest(
  authority: HostedAuthorityFence,
  libraries: readonly LocusProjectedLibraryContract[],
  systemFeatures: readonly LocusProjectionSystemFeature[],
  writableDocuments: readonly string[],
): string {
  return hosted_sha256(JSON.stringify({ format: "locus-effective-projection", authority,
    libraries: libraries.map((entry) => ({ name: entry.name, mode: entry.mode, schemaDigest: entry.schemaDigest, rootCodec: entry.rootCodec })),
    systemFeatures, writableDocuments,
  }));
}
