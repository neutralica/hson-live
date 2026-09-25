import type { PortableAggregateSnapshot } from "../livemap/livemap.hosted.internal.types.js";
import type { HostedLiveMapSnapshot } from "../../types/livemap.types.js";
import type { HsonSchemaData } from "../transform/transform.types.js";
import type { AuthorityProjectionSnapshot, LocusProjectionSystemFeature } from "../../types/locus.projection.types.js";
import type { HostedRegistry, HostedRegistryBinding } from "../livemap/livemap.hosted.js";
import type { LocusEffectiveProjection } from "./locus.projection.js";
import { locus_projection_contract_digest } from "./locus.projection.js";
import { assert_hosted_libraries_snapshot_shape, decode_hosted_root, encode_hosted_root, hosted_sha256, make_hosted_registry, HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted.js";
import { HsonSchema } from "../schema/hson-schema.js";
import { classify_live_root_mode } from "../livemap/livemap.document.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { interaction_schema_internal, project_interaction_state_internal } from "../interactions/interactions.projection.js";
import { INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME } from "../../internal/interaction-storage.js";
import type { LocusSessionManager } from "./locus.session.js";
import type { LiveMap } from "../../types/livemap.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";

const clientProjectionIdentity = new WeakMap<LiveMap, Readonly<{ digest: string; incarnationId: string }>>();
const admittedSnapshots = new WeakMap<object, AuthorityProjectionSnapshot>();

/** @internal The client contract digest is independent of its local registry. */
export function bind_client_projection_identity_internal(map: LiveMap, snapshot: AuthorityProjectionSnapshot): void {
  const admitted = admit_authority_projection_snapshot(snapshot);
  const previous = clientProjectionIdentity.get(map);
  if (previous !== undefined && previous.incarnationId === admitted.authority.incarnationId
    && previous.digest !== admitted.projectionDigest) fail();
  clientProjectionIdentity.set(map, Object.freeze({ digest: admitted.projectionDigest,
    incarnationId: admitted.authority.incarnationId }));
}

/** @internal */
export function client_projection_identity_internal(map: LiveMap): string | undefined {
  return clientProjectionIdentity.get(map)?.digest;
}

export const AUTHORITY_PROJECTION_SNAPSHOT_FORMAT: "hson-authority-projection-snapshot-v1" = "hson-authority-projection-snapshot-v1";

type Root = Readonly<{ format: "hson-exact-value"; payload: string }>;
type AuthorityProjectionLibrary = AuthorityProjectionSnapshot["libraries"][number];

function fail(): never { throw new Error("Authority projection snapshot is malformed."); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) return fail();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !("value" in property)) return fail();
    output[key] = property.value;
  }
  return output;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return fail();
  return value;
}
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value)) return fail(); return value; }
function json_utf8_bytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "string") return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1)
    + value.reduce<number>((total, item) => total + json_utf8_bytes(item), 0);
  if (typeof value !== "object") return fail();
  const entries = Object.entries(value);
  return 2 + Math.max(0, entries.length - 1)
    + entries.reduce((total, [key, item]) => total + json_utf8_bytes(key) + 1 + json_utf8_bytes(item), 0);
}
function root(value: unknown, schema: HsonSchema, mode: "data-object" | "data-array" | "document"): Root {
  const raw = record(value, ["format", "payload"]);
  if (raw.format !== "hson-exact-value" || typeof raw.payload !== "string") return fail();
  const decoded = decode_hosted_root(raw, HOSTED_MAX_SNAPSHOT_BYTES);
  admit_portable_hson_node(decoded, "authority projection snapshot");
  if (classify_live_root_mode(decoded) !== mode) return fail();
  validate_hson_schema_graph(schema, decoded);
  return Object.freeze({ format: "hson-exact-value", payload: raw.payload });
}

/** Decode and validate the entire candidate before any client runtime is constructed. */
export function admit_authority_projection_snapshot(input: unknown): AuthorityProjectionSnapshot {
  if (typeof input === "object" && input !== null) {
    const admitted = admittedSnapshots.get(input);
    if (admitted !== undefined) return admitted;
  }
  try {
    const value = record(input, ["format", "authority", "revision", "projectionDigest", "libraries", "htmlDocument", "systemFeatures", "writableDocuments", "system"]);
    const revision = value.revision;
    if (value.format !== AUTHORITY_PROJECTION_SNAPSHOT_FORMAT || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return fail();
    const binding = record(value.authority, ["logicalMapId", "incarnationId"]);
    const authority = Object.freeze({ logicalMapId: string(binding.logicalMapId), incarnationId: string(binding.incarnationId) });
    const digest = string(value.projectionDigest);
    if (!/^[a-f0-9]{64}$/.test(digest)) return fail();
    const names = new Set<string>();
    const libraries = array(value.libraries).map((candidate): AuthorityProjectionLibrary => {
      const entry = record(candidate, ["name", "mode", "schema", "schemaDigest", "rootCodec", "root"]);
      const name = string(entry.name);
      if (names.has(name)) return fail();
      names.add(name);
      const mode = entry.mode;
      if (mode !== "data-object" && mode !== "data-array" && mode !== "document") return fail();
      const suppliedSchema = string(entry.schema);
      const schema = HsonSchema.fromHson(suppliedSchema);
      const schemaSource: HsonSchemaData = schema.toHson();
      if (schemaSource !== suppliedSchema || entry.schemaDigest !== hosted_sha256(schemaSource) || entry.rootCodec !== "hson-exact-value") return fail();
      return Object.freeze({ name, mode, schema: schemaSource, schemaDigest: hosted_sha256(schemaSource), rootCodec: "hson-exact-value",
        root: root(entry.root, schema, mode) });
    });
    if (libraries.some((entry, index) => index > 0 && libraries[index - 1]!.name.localeCompare(entry.name) >= 0)) return fail();
    const htmlDocument = value.htmlDocument;
    if (htmlDocument !== null && (typeof htmlDocument !== "string" || !libraries.some((entry) => entry.name === htmlDocument && entry.mode === "document"))) return fail();
    const systemFeatures: LocusProjectionSystemFeature[] = [];
    for (const feature of array(value.systemFeatures)) {
      if (feature !== "interactions" || systemFeatures.length > 0) return fail();
      systemFeatures.push(feature);
    }
    const writableDocuments: string[] = [];
    for (const name of array(value.writableDocuments)) {
      if (typeof name !== "string" || !libraries.some((entry) => entry.name === name && entry.mode === "document")
        || (writableDocuments.length > 0 && writableDocuments[writableDocuments.length - 1]!.localeCompare(name) >= 0)) return fail();
      writableDocuments.push(name);
    }
    const includedDocuments = new Set(libraries.filter((entry) => entry.mode === "document").map((entry) => entry.name));
    let system: AuthorityProjectionSnapshot["system"] = null;
    if (systemFeatures.length === 1) {
      const state = record(value.system, ["interactions"]);
      const validatedRoot = root(state.interactions, interaction_schema_internal(), "data-object");
      const projected = project_interaction_state_internal(decode_hosted_root(validatedRoot, HOSTED_MAX_SNAPSHOT_BYTES), includedDocuments);
      if (encode_hosted_root(projected, HOSTED_MAX_SNAPSHOT_BYTES).payload !== validatedRoot.payload) return fail();
      system = Object.freeze({ interactions: validatedRoot });
    } else if (value.system !== null) return fail();
    const contract = libraries.map(({ root: _root, ...entry }) => entry);
    if (locus_projection_contract_digest(authority, contract, htmlDocument, systemFeatures, writableDocuments) !== digest) return fail();
    const snapshot: AuthorityProjectionSnapshot = Object.freeze({ format: AUTHORITY_PROJECTION_SNAPSHOT_FORMAT,
      authority, revision, projectionDigest: digest, libraries: Object.freeze(libraries),
      htmlDocument, systemFeatures: Object.freeze(systemFeatures),
      writableDocuments: Object.freeze(writableDocuments), system });
    if (json_utf8_bytes(snapshot) > HOSTED_MAX_SNAPSHOT_BYTES) return fail();
    admittedSnapshots.set(snapshot, snapshot);
    return snapshot;
  } catch { return fail(); }
}

export function encode_authority_projection_snapshot(snapshot: AuthorityProjectionSnapshot): string {
  return JSON.stringify(admit_authority_projection_snapshot(snapshot));
}

export function decode_authority_projection_snapshot(encoded: string): AuthorityProjectionSnapshot {
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > HOSTED_MAX_SNAPSHOT_BYTES) return fail();
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (JSON.stringify(parsed) !== encoded) return fail();
    return admit_authority_projection_snapshot(parsed);
  } catch { return fail(); }
}

/** Pure projection of one atomic authority cut under an already-normalized session scope. */
export function project_authority_snapshot(
  complete: HostedLiveMapSnapshot,
  effective: LocusEffectiveProjection,
): AuthorityProjectionSnapshot {
  try {
    assert_hosted_libraries_snapshot_shape(complete);
    if (complete.authority.logicalMapId !== effective.authority.logicalMapId
      || complete.authority.incarnationId !== effective.authority.incarnationId) return fail();
    const byName = new Map(complete.libraries.map((entry) => [entry.name, entry]));
    const byContract = new Map(complete.registry.libraries.map((entry) => [entry.name, entry]));
    const libraries = effective.libraries.map((contract): AuthorityProjectionLibrary => {
      const captured = byName.get(contract.name);
      const current = byContract.get(contract.name);
      if (captured === undefined || current === undefined || current.scope !== undefined
        || current.mode !== contract.mode || current.schema !== contract.schema || current.schemaDigest !== contract.schemaDigest
        || current.rootCodec !== contract.rootCodec) return fail();
      return Object.freeze({ ...contract, root: captured.root });
    });
    const includedDocuments = new Set(libraries.filter((entry) => entry.mode === "document").map((entry) => entry.name));
    let system: AuthorityProjectionSnapshot["system"] = null;
    if (effective.hasSystemFeature("interactions")) {
      const captured = byName.get(INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME);
      if (captured === undefined) return fail();
      system = Object.freeze({ interactions: encode_hosted_root(project_interaction_state_internal(decode_hosted_root(captured.root), includedDocuments)) });
    }
    return admit_authority_projection_snapshot(Object.freeze({ format: AUTHORITY_PROJECTION_SNAPSHOT_FORMAT,
      authority: effective.authority, revision: complete.revision, projectionDigest: effective.digest,
      libraries, htmlDocument: effective.htmlDocument ?? null, systemFeatures: effective.systemFeatures,
      writableDocuments: effective.writableDocuments, system,
    }));
  } catch { return fail(); }
}

/** Capture the already-authorized subset directly from one synchronous map revision. @internal */
export function capture_selected_authority_projection_snapshot(
  map: LiveMap,
  effective: LocusEffectiveProjection,
): AuthorityProjectionSnapshot {
  try {
    const selected = internal_livemap_aggregate_authority(map).captureSelectedHosted(
      effective.libraries.map((entry) => entry.name), effective.hasSystemFeature("interactions"));
    if (selected.authority.logicalMapId !== effective.authority.logicalMapId
      || selected.authority.incarnationId !== effective.authority.incarnationId) return fail();
    const libraries: AuthorityProjectionLibrary[] = effective.libraries.map((contract, index) => {
      const captured = selected.libraries[index];
      if (captured?.name !== contract.name) return fail();
      return Object.freeze({ ...contract, root: captured.root });
    });
    const includedDocuments = new Set(libraries.filter((entry) => entry.mode === "document").map((entry) => entry.name));
    const system = selected.system === null ? null : Object.freeze({ interactions: encode_hosted_root(
      project_interaction_state_internal(decode_hosted_root(selected.system, HOSTED_MAX_SNAPSHOT_BYTES), includedDocuments),
      HOSTED_MAX_SNAPSHOT_BYTES) });
    return admit_authority_projection_snapshot(Object.freeze({ format: AUTHORITY_PROJECTION_SNAPSHOT_FORMAT,
      authority: selected.authority, revision: selected.revision, projectionDigest: effective.digest,
      libraries, htmlDocument: effective.htmlDocument ?? null, systemFeatures: effective.systemFeatures,
      writableDocuments: effective.writableDocuments, system,
    }));
  } catch { return fail(); }
}

/** Capture once, then consume the session's immutable Step 6A scope. @internal */
export function capture_locus_session_authority_projection_snapshot(
  map: LiveMap,
  sessions: LocusSessionManager,
  sessionId: string,
): AuthorityProjectionSnapshot {
  try {
    const effective = sessions.projection(sessionId);
    if (effective === undefined) return fail();
    return capture_selected_authority_projection_snapshot(map, effective);
  } catch { return fail(); }
}

/** Runtime-only adapter for the existing Step 6A.5 ownership machinery. @internal */
export function authority_projection_as_client_composition_internal(input: AuthorityProjectionSnapshot): PortableAggregateSnapshot {
  const snapshot = admit_authority_projection_snapshot(input);
  const entries: HostedRegistryBinding[] = snapshot.libraries.map((entry) => ({ name: entry.name, mode: entry.mode, schema: HsonSchema.fromHson(entry.schema), identity: Object.freeze({}) }));
  const systemSchema = interaction_schema_internal();
  if (snapshot.system !== null) entries.push({
    name: INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
    mode: "data-object",
    schema: systemSchema,
    identity: Object.freeze({}),
    scope: "hson-internal",
  });
  // LiveMap's ordinary hosted registry is nonempty; an authority projection
  // may legitimately have no entries while client-local declarations exist.
  const emptyRegistry: HostedRegistry = Object.freeze({ format: "hson-hosted-registry", libraries: Object.freeze([]),
    digest: hosted_sha256(JSON.stringify({ format: "hson-hosted-registry", libraries: [] })) });
  const registry = entries.length === 0 ? emptyRegistry : make_hosted_registry(entries);
  const libraries = snapshot.libraries.map((entry) => Object.freeze({
    name: entry.name, mode: entry.mode, schema: entry.schema, schemaDigest: entry.schemaDigest, root: entry.root,
  }));
  if (snapshot.system !== null) libraries.push(Object.freeze({
    name: INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME, mode: "data-object", schema: systemSchema.toHson(),
    schemaDigest: hosted_sha256(systemSchema.toHson()), root: snapshot.system.interactions,
  }));
  return Object.freeze({ format: "hson-portable-aggregate-snapshot-v1", authority: snapshot.authority,
    revision: snapshot.revision, registry, registryDigest: registry.digest, libraries: Object.freeze(libraries) });
}
