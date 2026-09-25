import type { HostedLiveMapSnapshot } from "../../types/livemap.types.js";
import type { HsonNode } from "../../core/types.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME } from "../../internal/interaction-storage.js";
import { decode_hosted_root, encode_hosted_root, hosted_sha256, make_portable_aggregate_commit, make_hosted_registry, type HostedAggregateCommit, type PortableAggregateCommit, type PortableAggregateOperation, type HostedRegistryBinding } from "../livemap/livemap.hosted.js";
import { encode_livemap_replay_transport } from "../livemap/livemap.transport.js";
import { project_authority_snapshot } from "./locus.authority-projection-snapshot.js";
import { HsonSchema } from "../schema/hson-schema.js";
import { interaction_schema_internal, project_interaction_state_internal } from "../interactions/interactions.projection.js";
import type { LocusEffectiveProjection } from "./locus.projection.js";

/** Session-projected commit contract for visible authority effects. */
export const LOCUS_LIVE_PROJECTED_COMMIT_FORMAT = "hson-locus-live-projected-client-commit-v3" as const;
export const LOCUS_LIVE_PROJECTED_WIRE_FORMAT = "hson-locus-live-projected-client-wire-v3" as const;

export type LocusLiveProjectedCommit = Readonly<{
  format: typeof LOCUS_LIVE_PROJECTED_COMMIT_FORMAT;
  authority: HostedAggregateCommit["authority"];
  registryDigest: string;
  previousRegistryDigest?: string;
  topology?: import("../../types/livemap.types.js").LiveMapLibraryAddOperation;
  prevRev: number;
  rev: number;
  operations: readonly PortableAggregateOperation[];
}>;

export type LocusLiveProjectedEvent =
  | Readonly<{ kind: "commit"; commit: LocusLiveProjectedCommit }>
  | Readonly<{ kind: "progress"; progress: Readonly<{
    logicalMapId: string; incarnationId: string; registryDigest: string; prevRev: number; rev: number;
  }> }>;

export type LocusLiveProjectedWireEnvelope = Readonly<{
  format: typeof LOCUS_LIVE_PROJECTED_WIRE_FORMAT;
  logicalMapId: string;
  incarnationId: string;
  registryDigest: string;
  commit: LocusLiveProjectedCommit;
}>;

function exact_record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).length !== keys.length
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new Error("Projected live commit is malformed.");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !("value" in property)) throw new Error("Projected live commit is malformed.");
    result[key] = property.value;
  }
  return result;
}

/** Admit the versioned live envelope before handing operations to LiveMap's full codec. */
export function decode_locus_live_projected_envelope_internal(
  input: unknown,
  expected: Readonly<{ logicalMapId: string; incarnationId: string; registryDigest: string }>,
): PortableAggregateCommit {
  const envelope = exact_record(input, ["format", "logicalMapId", "incarnationId", "registryDigest", "commit"]);
  if (envelope.format !== LOCUS_LIVE_PROJECTED_WIRE_FORMAT
    || envelope.logicalMapId !== expected.logicalMapId
    || envelope.incarnationId !== expected.incarnationId) throw new Error("Projected live wire fence is incompatible.");
  const topology = typeof envelope.commit === "object" && envelope.commit !== null
    && Object.hasOwn(envelope.commit, "topology");
  const commit = exact_record(envelope.commit, topology
    ? ["format", "authority", "registryDigest", "previousRegistryDigest", "topology", "prevRev", "rev", "operations"]
    : ["format", "authority", "registryDigest", "prevRev", "rev", "operations"]);
  const authority = exact_record(commit.authority, ["logicalMapId", "incarnationId"]);
  if (commit.format !== LOCUS_LIVE_PROJECTED_COMMIT_FORMAT
    || authority.logicalMapId !== envelope.logicalMapId
    || authority.incarnationId !== envelope.incarnationId
    || commit.registryDigest !== envelope.registryDigest
    || (topology && commit.previousRegistryDigest !== expected.registryDigest)
    || (!topology && commit.registryDigest !== expected.registryDigest)) {
    throw new Error("Projected live commit fence is incompatible.");
  }
  return Object.freeze({ ...commit, format: "hson-portable-aggregate-commit-v1" }) as PortableAggregateCommit;
}

/** Pure per-revision projection. Later replay can supply the same before/after cuts. */
export function project_locus_live_revision_internal(
  authority: HostedAggregateCommit,
  before: HostedLiveMapSnapshot,
  after: HostedLiveMapSnapshot,
  effective: LocusEffectiveProjection,
): LocusLiveProjectedEvent {
  if (before.revision !== authority.prevRev || after.revision !== authority.rev
    || authority.rev !== authority.prevRev + 1
    || authority.authority.logicalMapId !== effective.authority.logicalMapId
    || authority.authority.incarnationId !== effective.authority.incarnationId
    || before.authority.logicalMapId !== effective.authority.logicalMapId
    || after.authority.logicalMapId !== effective.authority.logicalMapId
    || before.authority.incarnationId !== effective.authority.incarnationId
    || after.authority.incarnationId !== effective.authority.incarnationId) {
    throw new Error("Live projection authority transition is incompatible.");
  }
  // Snapshot validation stays with the Step 6B codec; the semantic boundary
  // below also accepts detached prepared roots before authority acceptance.
  const beforeVisible = project_authority_snapshot(before, effective);
  const afterVisible = project_authority_snapshot(after, effective);
  return project_locus_live_transition_internal(authority, effective,
    beforeVisible.system === null ? undefined : decode_hosted_root(beforeVisible.system.interactions),
    afterVisible.system === null ? undefined : decode_hosted_root(afterVisible.system.interactions));
}

export function projected_registry_digest(effective: LocusEffectiveProjection): string {
  const bindings: HostedRegistryBinding[] = effective.libraries.map((entry) => Object.freeze({
    name: entry.name, mode: entry.mode, schema: HsonSchema.fromHson(entry.schema), identity: Object.freeze({}),
  }));
  if (effective.hasSystemFeature("interactions")) bindings.push(Object.freeze({
    name: INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME, scope: "hson-internal", mode: "data-object",
    schema: interaction_schema_internal(), identity: Object.freeze({}),
  }));
  if (bindings.length === 0) return hosted_sha256(JSON.stringify({ format: "hson-hosted-registry", libraries: [] }));
  return make_hosted_registry(bindings).digest;
}

/** Reusable pure semantic boundary; prepared and retained transitions feed the same operation. */
export function project_locus_live_transition_internal(
  authority: HostedAggregateCommit,
  effective: LocusEffectiveProjection,
  beforeSystemRoot?: HsonNode,
  afterSystemRoot?: HsonNode,
): LocusLiveProjectedEvent {
  if (authority.rev !== authority.prevRev + 1
    || authority.authority.logicalMapId !== effective.authority.logicalMapId
    || authority.authority.incarnationId !== effective.authority.incarnationId) {
    throw new Error("Live projection authority transition is incompatible.");
  }
  const registryDigest = projected_registry_digest(effective);
  const complete = make_portable_aggregate_commit(authority);
  if (complete?.topology !== undefined) {
    const visible = complete.topology.operation.libraries.filter((entry) => effective.includesLibrary(entry.name));
    if (visible.length === 0) return Object.freeze({ kind: "progress", progress: Object.freeze({
      logicalMapId: effective.authority.logicalMapId, incarnationId: effective.authority.incarnationId,
      registryDigest, prevRev: authority.prevRev, rev: authority.rev,
    }) });
    const addedNames = new Set(visible.map((entry) => entry.name));
    const previousRegistryDigest = projected_registry_digest(Object.freeze({ ...effective,
      libraries: Object.freeze(effective.libraries.filter((entry) => !addedNames.has(entry.name))) }));
    const first = visible[0];
    if (first === undefined) throw new Error("Projected topology addition is empty.");
    return Object.freeze({ kind: "commit", commit: Object.freeze({
      format: LOCUS_LIVE_PROJECTED_COMMIT_FORMAT, authority: effective.authority,
      previousRegistryDigest, registryDigest, prevRev: authority.prevRev, rev: authority.rev,
      topology: Object.freeze({ library: first.name,
        operation: Object.freeze({ kind: "library-add" as const, libraries: Object.freeze(visible) }) }),
      operations: Object.freeze([]),
    }) });
  }
  const operations: PortableAggregateOperation[] = complete?.operations.filter((entry) =>
    entry.library !== INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME && effective.includesLibrary(entry.library)) ?? [];
  if (effective.hasSystemFeature("interactions")) {
    if (beforeSystemRoot === undefined || afterSystemRoot === undefined) throw new Error("Projected interaction state is unavailable.");
    const includedDocuments = new Set(effective.libraries.filter((entry) => entry.mode === "document").map((entry) => entry.name));
    const previous = project_interaction_state_internal(beforeSystemRoot, includedDocuments);
    const next = project_interaction_state_internal(afterSystemRoot, includedDocuments);
    if (encode_hosted_root(previous).payload !== encode_hosted_root(next).payload) {
      const payload = encode_livemap_replay_transport([Object.freeze({
        kind: "replace", path: Object.freeze([]),
        prev: projected_value_from_hson_node(previous),
        next: projected_value_from_hson_node(next),
      })]).payload;
      operations.push(Object.freeze({ library: INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
        domain: "data", kind: "replace", format: "structural-json", payload }));
    }
  }
  if (operations.length === 0) return Object.freeze({ kind: "progress", progress: Object.freeze({
    logicalMapId: effective.authority.logicalMapId, incarnationId: effective.authority.incarnationId,
    registryDigest, prevRev: authority.prevRev, rev: authority.rev,
  }) });
  return Object.freeze({ kind: "commit", commit: Object.freeze({
    format: LOCUS_LIVE_PROJECTED_COMMIT_FORMAT, authority: effective.authority,
    registryDigest, prevRev: authority.prevRev, rev: authority.rev,
    operations: Object.freeze(operations),
  }) });
}
