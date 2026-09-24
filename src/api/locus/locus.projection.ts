import type {
  LocusConnectionContext,
  LocusExposureEntry,
  LocusProjectionAuthorization,
  LocusProjectionAuthorizer,
  LocusProjectionSystemFeature,
  LocusRequestedProjection,
} from "../../types/locus.types.js";
import type { HostedAuthorityFence, HostedRegistry, HostedRegistryEntry } from "../livemap/livemap.hosted.js";
import { hosted_sha256 } from "../livemap/livemap.hosted.js";
import { HsonSchema } from "../schema/hson-schema.js";

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
  htmlDocument?: string;
  systemFeatures: readonly LocusProjectionSystemFeature[];
  writableDocuments: readonly string[];
  digest: string;
  includesLibrary: (name: string) => boolean;
  canAuthorDocument: (name: string) => boolean;
  hasSystemFeature: (feature: LocusProjectionSystemFeature) => boolean;
}>;

export type LocusHostedProjectionPolicy = Readonly<{
  registry: HostedRegistry;
  authority: HostedAuthorityFence;
  exposure: ReadonlyMap<string, "server-private" | "client-public">;
  defaultProjection?: LocusRequestedProjection;
  authorizeProjection?: LocusProjectionAuthorizer;
}>;

/** Validate deployment policy against the restored/current fixed application registry. */
export function make_locus_hosted_projection_policy(
  registry: HostedRegistry,
  authority: HostedAuthorityFence,
  exposureEntries: readonly LocusExposureEntry[],
  defaultProjection?: LocusRequestedProjection,
  authorizeProjection?: LocusProjectionAuthorizer,
): LocusHostedProjectionPolicy {
  if (!Array.isArray(exposureEntries)) throw new Error("Hosted Locus exposure configuration is required.");
  const application = new Map(registry.libraries.filter((entry) => entry.scope !== "hson-internal").map((entry) => [entry.name, entry]));
  const exposure = new Map<string, "server-private" | "client-public">();
  for (const entry of exposureEntries) {
    if (typeof entry !== "object" || entry === null || typeof entry.library !== "string" || !application.has(entry.library)) {
      throw new Error("Hosted Locus exposure configuration contains an unknown application library.");
    }
    if (exposure.has(entry.library)) throw new Error(`Hosted Locus exposure configuration duplicates ${JSON.stringify(entry.library)}.`);
    if (entry.exposure !== "server-private" && entry.exposure !== "client-public") {
      throw new Error(`Hosted Locus exposure configuration has an invalid value for ${JSON.stringify(entry.library)}.`);
    }
    exposure.set(entry.library, entry.exposure);
  }
  for (const name of application.keys()) {
    if (!exposure.has(name)) throw new Error(`Hosted Locus exposure configuration is missing ${JSON.stringify(name)}.`);
  }
  if (authorizeProjection !== undefined && typeof authorizeProjection !== "function") {
    throw new Error("Hosted Locus projection authorizer must be a function.");
  }
  if (defaultProjection !== undefined) normalize_request(defaultProjection);
  return Object.freeze({ registry, authority: Object.freeze({ ...authority }), exposure,
    ...(defaultProjection === undefined ? {} : { defaultProjection: normalize_request(defaultProjection) }),
    ...(authorizeProjection === undefined ? {} : { authorizeProjection }),
  });
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
  if (typeof input !== "object" || input === null) throw new LocusProjectionUnavailableError();
  const libraries = normalize_names(input.libraries);
  if (input.htmlDocument !== undefined && (typeof input.htmlDocument !== "string" || input.htmlDocument.length === 0)) {
    throw new LocusProjectionUnavailableError();
  }
  return Object.freeze({
    libraries: Object.freeze([...new Set([...libraries, ...(input.htmlDocument === undefined ? [] : [input.htmlDocument])])].sort()),
    ...(input.htmlDocument === undefined ? {} : { htmlDocument: input.htmlDocument }),
    systemFeatures: normalize_features(input.systemFeatures),
  });
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
      && policy.exposure.get(entry.name) === "client-public"
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
  if (requested.htmlDocument !== undefined && !included.some((entry) => entry.name === requested.htmlDocument && entry.mode === "document")) {
    throw new LocusProjectionUnavailableError();
  }
  const features = Object.freeze((requested.systemFeatures ?? []).filter((feature) => allowedFeatures.has(feature)
    && (feature !== "interactions" || policy.registry.libraries.some((entry) => entry.scope === "hson-internal"))));
  const writable = Object.freeze(included.filter((entry) => entry.mode === "document" && allowedWritable.has(entry.name)).map((entry) => entry.name));
  const authority = Object.freeze({ ...policy.authority });
  // The canonical digest input has no root, revision, policy, or excluded registry topology.
  const digest = locus_projection_contract_digest(authority, included, requested.htmlDocument ?? null, features, writable);
  return Object.freeze({ authority, libraries: Object.freeze(included),
    ...(requested.htmlDocument === undefined ? {} : { htmlDocument: requested.htmlDocument }),
    systemFeatures: features, writableDocuments: writable, digest,
    includesLibrary: (name: string) => includedNames.has(name),
    canAuthorDocument: (name: string) => writable.includes(name),
    hasSystemFeature: (feature: LocusProjectionSystemFeature) => features.includes(feature),
  });
}

/** The Step 6A digest definition, also used to admit a decoded Step 6B contract. @internal */
export function locus_projection_contract_digest(
  authority: HostedAuthorityFence,
  libraries: readonly LocusProjectedLibraryContract[],
  htmlDocument: string | null,
  systemFeatures: readonly LocusProjectionSystemFeature[],
  writableDocuments: readonly string[],
): string {
  return hosted_sha256(JSON.stringify({ format: "locus-effective-projection-v1", authority,
    libraries: libraries.map((entry) => ({ name: entry.name, mode: entry.mode, schemaDigest: entry.schemaDigest, rootCodec: entry.rootCodec })),
    htmlDocument, systemFeatures, writableDocuments,
  }));
}
