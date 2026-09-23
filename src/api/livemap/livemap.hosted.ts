import { admit_projected_value } from "../../core/projected-value-admission.js";
import { is_Node } from "../../core/node-guards.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonNode, JsonValue, Primitive } from "../../core/types.js";
import type { HsonSchema, HsonSchemaData } from "../transform/transform.types.js";
import type {
  LiveMapAnyOp,
  LiveMapDataOp,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget,
  LiveMapGraphOp,
  LiveMapRootMode,
  HostedLiveMapLibrariesSnapshot,
  HostedClientLibrariesSnapshot,
  LiveMapLibrariesSnapshot,
  LocalLibrariesContinuationSnapshot,
  LivePath,
} from "../../types/livemap.types.js";
import type {
  LiveMapProjectedGraphEnsureQuidOp,
  LiveMapProjectedIdentityCommitTarget,
} from "./livemap.identity.types.js";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
} from "./livemap.document.view-state-codec.js";
import {
  decode_livemap_replay_payload,
  encode_livemap_replay_transport,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";
import type { LiveMapLibraryIdentity } from "./livemap.library.js";
import type { LiveMapSystemIdentity } from "./livemap.system.js";
import { validate_document_path } from "./livemap.document.path.js";
import { normalize_replacement_lineage } from "./livemap.document.lineage.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";

export const HOSTED_REGISTRY_FORMAT = "hson-hosted-registry" as const;
export const HOSTED_COMMIT_FORMAT = "hson-hosted-commit" as const;
export const LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT = "hson-livemap-libraries-snapshot" as const;
export const HOSTED_GRAPH_OP_FORMAT = "hson-hosted-graph-op-v2" as const;
export const HOSTED_CLIENT_GRAPH_OP_FORMAT = "hson-hosted-client-graph-op-v1" as const;
export const HOSTED_CLIENT_COMMIT_FORMAT = "hson-hosted-client-commit-v1" as const;
export const HOSTED_CLIENT_SNAPSHOT_FORMAT = "hson-livemap-client-snapshot-v1" as const;
export const HOSTED_ROOT_FORMAT = "hson-exact-value" as const;

export const HOSTED_MAX_LIBRARIES = 1_024;
export const HOSTED_MAX_LIBRARY_NAME_BYTES = 1_024;
export const HOSTED_MAX_OPERATIONS = 100_000;
export const HOSTED_MAX_COMMIT_BYTES = 16 * 1_024 * 1_024;
export const HOSTED_MAX_SNAPSHOT_BYTES = 64 * 1_024 * 1_024;
export const HOSTED_MAX_ISSUED_QUIDS = 1_000_000;

const encoder = new TextEncoder();

export type HostedAuthorityFence = Readonly<{
  logicalMapId: string;
  incarnationId: string;
}>;

export type HostedRegistryEntry = Readonly<{
  name: string;
  /** Presence marks an Hson-owned entry; ordinary application entries retain their established shape. */
  scope?: "hson-internal";
  mode: LiveMapRootMode;
  schema: HsonSchemaData;
  schemaDigest: string;
  rootCodec: typeof HOSTED_ROOT_FORMAT;
}>;

export type HostedRegistry = Readonly<{
  format: typeof HOSTED_REGISTRY_FORMAT;
  libraries: readonly HostedRegistryEntry[];
  digest: string;
}>;

export type HostedRegistryBinding = Readonly<{
  name: string;
  scope?: "hson-internal";
  identity: LiveMapLibraryIdentity | LiveMapSystemIdentity;
  mode: LiveMapRootMode;
  schema: HsonSchema;
}>;

export type HostedSemanticOperation = Readonly<{
  library: string;
  operation: LiveMapAnyOp;
}>;

export type HostedReplayOperation = Readonly<{
  library: string;
  domain: "data" | "graph";
  kind: string;
  format: "structural-json" | typeof HOSTED_GRAPH_OP_FORMAT;
  payload: string;
}>;

export type HostedAggregateCommit = Readonly<{
  format: typeof HOSTED_COMMIT_FORMAT;
  authority: HostedAuthorityFence;
  registryDigest: string;
  changed: boolean;
  prevRev: number;
  rev: number;
  operations: readonly HostedSemanticOperation[];
  replay: Readonly<{ operations: readonly HostedReplayOperation[] }>;
}>;

/** Replica-relevant effects at one authority revision, with no runtime QUID evidence. */
export type HostedClientOperation =
  | Readonly<{
    library: string;
    domain: "data";
    kind: LiveMapDataOp["kind"];
    format: "structural-json";
    payload: string;
  }>
  | Readonly<{
    library: string;
    domain: "graph";
    kind: Exclude<LiveMapGraphOp["op"], "ensure-quid">;
    format: typeof HOSTED_CLIENT_GRAPH_OP_FORMAT;
    payload: string;
  }>;

export type HostedClientCommit = Readonly<{
  format: typeof HOSTED_CLIENT_COMMIT_FORMAT;
  authority: HostedAuthorityFence;
  registryDigest: string;
  prevRev: number;
  rev: number;
  operations: readonly HostedClientOperation[];
}>;

export type DecodedHostedOperation = Readonly<{
  library: HostedRegistryBinding;
  semantic: LiveMapAnyOp;
  projected?: LiveMapProjectedDataOp;
  graph?: LiveMapGraphOp | LiveMapProjectedGraphEnsureQuidOp;
}>;

export class HostedAggregateRepresentationError extends Error {
  constructor(message: string, readonly operationIndex?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostedAggregateRepresentationError";
  }
}

export function make_hosted_registry(bindings: readonly HostedRegistryBinding[]): HostedRegistry {
  if (bindings.length === 0 || bindings.length > HOSTED_MAX_LIBRARIES) {
    throw new HostedAggregateRepresentationError("Hosted registry library count is outside its supported bound.");
  }
  const names = new Set<string>();
  const libraries = bindings.map(({ name, scope, mode, schema }): HostedRegistryEntry => {
    must_library_name(name);
    if (names.has(name)) throw new HostedAggregateRepresentationError(`Hosted Library name ${JSON.stringify(name)} is duplicated.`);
    names.add(name);
    if (scope !== undefined && scope !== "hson-internal") {
      throw new HostedAggregateRepresentationError("Hosted registry Library scope is malformed.");
    }
    if (mode !== "data-object" && mode !== "data-array" && mode !== "document") {
      throw new HostedAggregateRepresentationError("Hosted registry contains an unsupported root mode.");
    }
    if (typeof schema !== "object" || schema === null) throw new HostedAggregateRepresentationError("Hosted registry Schema source is malformed.");
    const source = schema.toHson();
    return Object.freeze({
      name,
      ...(scope === undefined ? {} : { scope }),
      mode,
      schema: source,
      schemaDigest: hosted_sha256(source),
      rootCodec: HOSTED_ROOT_FORMAT,
    });
  });
  const canonical = registry_canonical_text(libraries);
  return Object.freeze({
    format: HOSTED_REGISTRY_FORMAT,
    libraries: Object.freeze(libraries),
    digest: hosted_sha256(canonical),
  });
}

export function make_hosted_authority_fence(): HostedAuthorityFence {
  return Object.freeze({
    logicalMapId: hosted_identity("map"),
    incarnationId: hosted_identity("incarnation"),
  });
}

export function make_hosted_commit(
  fence: HostedAuthorityFence,
  registry: HostedRegistry,
  bindingsByIdentity: ReadonlyMap<object, HostedRegistryBinding>,
  input: Readonly<{
    changed: boolean;
    prevRev: number;
    rev: number;
    operations: readonly Readonly<{
      target: Readonly<{ library?: LiveMapLibraryIdentity; system?: LiveMapSystemIdentity }>;
      operation: LiveMapAnyOp;
      projected?: LiveMapProjectedDataOp;
    }>[];
  }>,
): HostedAggregateCommit {
  if (input.operations.length > HOSTED_MAX_OPERATIONS) {
    throw new HostedAggregateRepresentationError("Hosted commit operation count exceeds its supported bound.");
  }
  const semantic: HostedSemanticOperation[] = [];
  const replay: HostedReplayOperation[] = [];
  for (const entry of input.operations) {
    const identity = entry.target.library ?? entry.target.system;
    const binding = identity === undefined ? undefined : bindingsByIdentity.get(identity);
    if (binding === undefined) throw new HostedAggregateRepresentationError("Hosted commit references an unregistered Library identity.");
    const evidence = entry.projected === undefined
      ? encode_hosted_operation(binding.name, binding.mode, entry.operation)
      : Object.freeze({
        library: binding.name,
        domain: "data" as const,
        kind: entry.projected.kind,
        format: LIVEMAP_STRUCTURAL_JSON_FORMAT,
        payload: encode_livemap_replay_transport([entry.projected]).payload,
      });
    const operation = evidence.domain === "data"
      ? materialize_livemap_projected_op(require_single_projected_operation(evidence.payload))
      : decode_hosted_graph_operation(evidence.payload, binding.mode);
    semantic.push(Object.freeze({ library: binding.name, operation }));
    replay.push(evidence);
  }
  const commit: HostedAggregateCommit = Object.freeze({
    format: HOSTED_COMMIT_FORMAT,
    authority: fence,
    registryDigest: registry.digest,
    changed: input.changed,
    prevRev: input.prevRev,
    rev: input.rev,
    operations: Object.freeze(semantic),
    replay: Object.freeze({ operations: Object.freeze(replay) }),
  });
  assert_encoded_bound(commit, HOSTED_MAX_COMMIT_BYTES, "Hosted commit");
  return commit;
}

export function decode_hosted_commit(
  input: HostedAggregateCommit,
  registry: HostedRegistry,
  bindingsByName: ReadonlyMap<string, HostedRegistryBinding>,
): readonly DecodedHostedOperation[] {
  const record = exact_record(input, "Hosted commit");
  exact_keys(record, ["format", "authority", "registryDigest", "changed", "prevRev", "rev", "operations", "replay"], "Hosted commit");
  if (record.format !== HOSTED_COMMIT_FORMAT || record.registryDigest !== registry.digest) {
    throw new HostedAggregateRepresentationError("Hosted commit format or registry digest is incompatible.");
  }
  const authority = exact_record(record.authority, "Hosted commit authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted commit authority");
  if (typeof authority.logicalMapId !== "string" || authority.logicalMapId.length === 0
    || typeof authority.incarnationId !== "string" || authority.incarnationId.length === 0) {
    throw new HostedAggregateRepresentationError("Hosted commit authority fence is malformed.");
  }
  if (typeof record.changed !== "boolean" || !valid_revision(record.prevRev) || !valid_revision(record.rev)) {
    throw new HostedAggregateRepresentationError("Hosted commit revision envelope is malformed.");
  }
  const expectedRev = record.changed ? (record.prevRev as number) + 1 : record.prevRev;
  if (record.rev !== expectedRev) throw new HostedAggregateRepresentationError("Hosted commit revisions are inconsistent.");
  if (!Array.isArray(record.operations) || record.operations.length > HOSTED_MAX_OPERATIONS) {
    throw new HostedAggregateRepresentationError("Hosted commit semantic operation sequence is malformed.");
  }
  const replayRecord = exact_record(record.replay, "Hosted commit replay payload");
  exact_keys(replayRecord, ["operations"], "Hosted commit replay payload");
  if (!Array.isArray(replayRecord.operations) || replayRecord.operations.length !== record.operations.length) {
    throw new HostedAggregateRepresentationError("Hosted commit semantic and replay operation counts disagree.");
  }
  if ((record.changed as boolean) !== (record.operations.length > 0)) {
    throw new HostedAggregateRepresentationError("Hosted commit changed flag disagrees with its operation sequence.");
  }
  assert_encoded_bound(input, HOSTED_MAX_COMMIT_BYTES, "Hosted commit");
  return Object.freeze(record.operations.map((rawSemantic, index): DecodedHostedOperation => {
    const semantic = exact_record(rawSemantic, "Hosted semantic operation", index);
    exact_keys(semantic, ["library", "operation"], "Hosted semantic operation", index);
    const evidence = exact_record((replayRecord.operations as readonly unknown[])[index], "Hosted replay operation", index);
    exact_keys(evidence, ["library", "domain", "kind", "format", "payload"], "Hosted replay operation", index);
    if (typeof semantic.library !== "string" || evidence.library !== semantic.library) {
      throw new HostedAggregateRepresentationError("Hosted semantic and replay Library names disagree.", index);
    }
    const binding = bindingsByName.get(semantic.library);
    if (binding === undefined) throw new HostedAggregateRepresentationError("Hosted commit references an unknown Library.", index);
    const operation = semantic.operation as LiveMapAnyOp;
    if (evidence.domain === "data") {
      if (binding.mode === "document" || evidence.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
        throw new HostedAggregateRepresentationError("Hosted data replay evidence is incompatible.", index);
      }
      const projected = require_single_projected_operation(String(evidence.payload), index);
      if (evidence.kind !== projected.kind
        || !hosted_semantic_equal(operation, materialize_livemap_projected_op(projected))) {
        throw new HostedAggregateRepresentationError("Hosted semantic operation and exact replay evidence disagree.", index);
      }
      return Object.freeze({ library: binding, semantic: operation, projected });
    }
    const expected = encode_hosted_operation(binding.name, binding.mode, operation);
    if (evidence.domain !== expected.domain || evidence.kind !== expected.kind
      || evidence.format !== expected.format || evidence.payload !== expected.payload) {
      throw new HostedAggregateRepresentationError("Hosted semantic operation and exact replay evidence disagree.", index);
    }
    return Object.freeze({ library: binding, semantic: operation, graph: decode_hosted_graph_operation(expected.payload, binding.mode) });
  }));
}

/** Derive QUID-free semantic effects from a living authority transition. */
export function make_hosted_client_commit(authority: HostedAggregateCommit): HostedClientCommit | undefined {
  const operations: HostedClientCommit["operations"][number][] = [];
  for (let index = 0; index < authority.operations.length; index += 1) {
    const entry = authority.operations[index];
    const evidence = authority.replay.operations[index];
    if (entry === undefined || evidence === undefined || entry.library !== evidence.library) {
      throw new HostedAggregateRepresentationError("Authority history operation evidence is incomplete.");
    }
    const operation = entry.operation;
    if ("domain" in operation && operation.op === "ensure-quid") continue;
    if (evidence.domain === "data") {
      if ("domain" in operation) throw new HostedAggregateRepresentationError("Authority history operation domains disagree.");
      operations.push(Object.freeze({ library: entry.library, domain: "data", kind: operation.kind, format: "structural-json", payload: evidence.payload }));
      continue;
    }
    if (!("domain" in operation) || evidence.domain !== "graph") {
      throw new HostedAggregateRepresentationError("Authority history operation domains disagree.");
    }
    operations.push(Object.freeze({
      library: entry.library,
      domain: "graph",
      kind: operation.op,
      format: HOSTED_CLIENT_GRAPH_OP_FORMAT,
      payload: encode_hosted_graph_operation(operation, true),
    }));
  }
  if (operations.length === 0) return undefined;
  const commit: HostedClientCommit = Object.freeze({
    format: HOSTED_CLIENT_COMMIT_FORMAT,
    authority: authority.authority,
    registryDigest: authority.registryDigest,
    prevRev: authority.prevRev,
    rev: authority.rev,
    operations: Object.freeze(operations),
  });
  assert_encoded_bound(commit, HOSTED_MAX_COMMIT_BYTES, "Hosted client commit");
  return commit;
}

/** Strictly admit one current client event before local semantic replay. */
export function decode_hosted_client_commit(
  input: HostedClientCommit,
  registry: HostedRegistry,
  bindingsByName: ReadonlyMap<string, HostedRegistryBinding>,
): readonly DecodedHostedOperation[] {
  const record = exact_record(input, "Hosted client commit");
  exact_keys(record, ["format", "authority", "registryDigest", "prevRev", "rev", "operations"], "Hosted client commit");
  const authority = exact_record(record.authority, "Hosted client commit authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted client commit authority");
  if (record.format !== HOSTED_CLIENT_COMMIT_FORMAT || record.registryDigest !== registry.digest
    || typeof authority.logicalMapId !== "string" || !authority.logicalMapId
    || typeof authority.incarnationId !== "string" || !authority.incarnationId
    || !valid_revision(record.prevRev) || record.rev !== record.prevRev + 1
    || !Array.isArray(record.operations) || record.operations.length === 0
    || record.operations.length > HOSTED_MAX_OPERATIONS) {
    throw new HostedAggregateRepresentationError("Hosted client commit envelope is malformed.");
  }
  assert_encoded_bound(input, HOSTED_MAX_COMMIT_BYTES, "Hosted client commit");
  return Object.freeze(record.operations.map((raw, index): DecodedHostedOperation => {
    const evidence = exact_record(raw, "Hosted client operation", index);
    exact_keys(evidence, ["library", "domain", "kind", "format", "payload"], "Hosted client operation", index);
    if (typeof evidence.library !== "string" || typeof evidence.payload !== "string" || typeof evidence.kind !== "string") {
      throw new HostedAggregateRepresentationError("Hosted client operation fields are malformed.", index);
    }
    const binding = bindingsByName.get(evidence.library);
    if (binding === undefined) throw new HostedAggregateRepresentationError("Hosted client operation references an unknown Library.", index);
    if (evidence.domain === "data") {
      if (binding.mode === "document" || evidence.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) throw incompatible_graph();
      const projected = require_single_projected_operation(evidence.payload, index);
      if (projected.kind !== evidence.kind || encode_livemap_replay_transport([projected]).payload !== evidence.payload) {
        throw new HostedAggregateRepresentationError("Hosted client data operation is noncanonical.", index);
      }
      return Object.freeze({ library: binding, semantic: materialize_livemap_projected_op(projected), projected });
    }
    if (evidence.domain !== "graph" || evidence.format !== HOSTED_CLIENT_GRAPH_OP_FORMAT || binding.mode !== "document") {
      throw incompatible_graph();
    }
    const graph = decode_hosted_graph_operation(evidence.payload, binding.mode, true);
    if (graph.op === "ensure-quid" || graph.op !== evidence.kind
      || encode_hosted_graph_operation(graph, true) !== evidence.payload) {
      throw new HostedAggregateRepresentationError("Hosted client graph operation is noncanonical.", index);
    }
    return Object.freeze({ library: binding, semantic: graph, graph });
  }));
}

/** Project exact authority capture into the full, QUID-free Echo snapshot format. */
export function make_hosted_client_snapshot(authority: HostedLiveMapLibrariesSnapshot): HostedClientLibrariesSnapshot {
  assert_hosted_libraries_snapshot_shape(authority);
  const snapshot: HostedClientLibrariesSnapshot = Object.freeze({
    format: HOSTED_CLIENT_SNAPSHOT_FORMAT,
    revision: authority.revision,
    registry: authority.registry,
    registryDigest: authority.registryDigest,
    libraries: Object.freeze(authority.libraries.map((entry) => Object.freeze({
      ...entry,
      root: encode_hosted_root(clone_hson_graph_without_quids(decode_hosted_root(entry.root))),
    }))),
    authority: authority.authority,
  });
  assert_hosted_client_snapshot_shape(snapshot);
  return snapshot;
}

/** Reject all identity claims in a remote client snapshot before runtime installation. */
export function assert_hosted_client_snapshot_shape(snapshot: HostedClientLibrariesSnapshot): void {
  const record = exact_record(snapshot, "Hosted client snapshot");
  exact_keys(record, ["format", "revision", "registry", "registryDigest", "libraries", "authority"], "Hosted client snapshot");
  const authority = exact_record(record.authority, "Hosted client snapshot authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted client snapshot authority");
  if (record.format !== HOSTED_CLIENT_SNAPSHOT_FORMAT || !valid_revision(record.revision)
    || typeof authority.logicalMapId !== "string" || !authority.logicalMapId
    || typeof authority.incarnationId !== "string" || !authority.incarnationId) {
    throw new HostedAggregateRepresentationError("Hosted client snapshot envelope is malformed.");
  }
  assert_libraries_snapshot_entries(record);
  if (snapshot.registryDigest !== snapshot.registry.digest
    || snapshot.libraries.length !== snapshot.registry.libraries.length) {
    throw new HostedAggregateRepresentationError("Hosted client snapshot registry is malformed.");
  }
  for (const entry of snapshot.libraries) admit_portable_hson_node(decode_hosted_root(entry.root), "hosted client snapshot");
  assert_encoded_bound(snapshot, HOSTED_MAX_SNAPSHOT_BYTES, "Hosted client snapshot");
}

/** Reuse the portable local installer while retaining a distinct client wire format. */
export function hosted_client_snapshot_as_local(snapshot: HostedClientLibrariesSnapshot): LocalLibrariesContinuationSnapshot {
  assert_hosted_client_snapshot_shape(snapshot);
  return Object.freeze({
    format: LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
    revision: snapshot.revision,
    registry: snapshot.registry,
    registryDigest: snapshot.registryDigest,
    libraries: snapshot.libraries,
  });
}

function hosted_semantic_equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => hosted_semantic_equal(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => hosted_semantic_equal(
    (left as Record<string, unknown>)[key],
    (right as Record<string, unknown>)[key],
  ));
}

function require_single_projected_operation(payload: string, operationIndex?: number): LiveMapProjectedDataOp {
  const decoded = decode_livemap_replay_payload(payload);
  const projected = decoded[0];
  if (decoded.length !== 1 || projected === undefined) {
    throw new HostedAggregateRepresentationError("Hosted data operation payload is not singular.", operationIndex);
  }
  return projected;
}

export function encode_hosted_root(root: HsonNode): Readonly<{ format: typeof HOSTED_ROOT_FORMAT; payload: string }> {
  return Object.freeze({ format: HOSTED_ROOT_FORMAT, payload: encode_exact_hson_value(root) });
}

export function decode_hosted_root(input: unknown): HsonNode {
  const record = exact_record(input, "Hosted root encoding");
  exact_keys(record, ["format", "payload"], "Hosted root encoding");
  if (record.format !== HOSTED_ROOT_FORMAT || typeof record.payload !== "string") {
    throw new HostedAggregateRepresentationError("Hosted root encoding is malformed.");
  }
  const root = decode_exact_hson_value(record.payload);
  if (!is_Node(root)) throw new HostedAggregateRepresentationError("Hosted root encoding does not contain a canonical root.");
  return root;
}

export function assert_libraries_snapshot_bound(snapshot: LiveMapLibrariesSnapshot | LocalLibrariesContinuationSnapshot): void {
  assert_encoded_bound(snapshot, HOSTED_MAX_SNAPSHOT_BYTES, "Hosted aggregate snapshot");
}

export function assert_libraries_snapshot_shape(snapshot: LiveMapLibrariesSnapshot): void {
  const record = exact_record(snapshot, "Hosted aggregate snapshot");
  exact_keys(record, ["format", "revision", "registry", "registryDigest", "libraries"], "Hosted aggregate snapshot");
  assert_libraries_snapshot_entries(record);
}

/** Local browser bootstrap deliberately has no authority identity state. @internal */
export function assert_local_libraries_snapshot_shape(snapshot: LocalLibrariesContinuationSnapshot): void {
  assert_libraries_snapshot_shape(snapshot);
}

function assert_libraries_snapshot_entries(record: Readonly<Record<string, unknown>>): void {
  const registry = exact_record(record.registry, "Hosted snapshot registry");
  exact_keys(registry, ["format", "libraries", "digest"], "Hosted snapshot registry");
  if (!Array.isArray(registry.libraries) || !Array.isArray(record.libraries)) {
    throw new HostedAggregateRepresentationError("Hosted snapshot Library sequences are malformed.");
  }
  for (const entry of registry.libraries) {
    const item = exact_record(entry, "Hosted registry entry");
    exact_keys(item, entry.scope === undefined
      ? ["name", "mode", "schema", "schemaDigest", "rootCodec"]
      : ["name", "scope", "mode", "schema", "schemaDigest", "rootCodec"], "Hosted registry entry");
    if (entry.scope !== undefined && entry.scope !== "hson-internal") {
      throw new HostedAggregateRepresentationError("Hosted registry Library scope is malformed.");
    }
  }
  for (const entry of record.libraries) {
    const item = exact_record(entry, "Hosted snapshot Library");
    exact_keys(item, ["name", "mode", "schema", "schemaDigest", "root"], "Hosted snapshot Library");
  }
}

export function assert_hosted_libraries_snapshot_shape(snapshot: HostedLiveMapLibrariesSnapshot): void {
  const record = exact_record(snapshot, "Hosted aggregate snapshot");
  exact_keys(record, ["format", "revision", "registry", "registryDigest", "libraries", "identity", "authority"], "Hosted aggregate snapshot");
  const authority = exact_record(record.authority, "Hosted snapshot authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted snapshot authority");
  const identity = exact_record(record.identity, "Hosted snapshot identity");
  exact_keys(identity, ["epoch", "issuedQuids"], "Hosted snapshot identity");
  const semantic = Object.freeze({
    format: snapshot.format,
    revision: snapshot.revision,
    registry: snapshot.registry,
    registryDigest: snapshot.registryDigest,
    libraries: snapshot.libraries,
  });
  assert_libraries_snapshot_shape(semantic);
}

function encode_hosted_operation(name: string, mode: LiveMapRootMode, operation: LiveMapAnyOp): HostedReplayOperation {
  if (!("domain" in operation)) {
    if (mode === "document") throw new HostedAggregateRepresentationError("Data operation is incompatible with a document Library.");
    const projected = projected_operation_from_semantic(operation);
    const encoded = encode_livemap_replay_transport([projected]);
    return Object.freeze({ library: name, domain: "data", kind: operation.kind, format: encoded.format, payload: encoded.payload });
  }
  if (mode === "document") {
    if (operation.op === "ensure-quid" && "projected" in operation.target) {
      throw new HostedAggregateRepresentationError("Projected identity operation is incompatible with a document Library.");
    }
  } else if (operation.op !== "ensure-quid" || !("projected" in operation.target) || operation.target.projected !== true) {
    throw new HostedAggregateRepresentationError("Graph operation is incompatible with a data Library.");
  }
  return Object.freeze({
    library: name,
    domain: "graph",
    kind: operation.op,
    format: HOSTED_GRAPH_OP_FORMAT,
    payload: encode_hosted_graph_operation(operation),
  });
}

function projected_operation_from_semantic(op: LiveMapDataOp): LiveMapProjectedDataOp {
  const path = must_path(op.path);
  if (op.kind === "delete") return Object.freeze({ kind: op.kind, path, prev: optional_projected(op.prev), next: undefined });
  if (op.kind === "splice") return Object.freeze({
    kind: op.kind, path, start: op.start,
    removed: Object.freeze(op.removed.map((value) => admit_projected_value(value))),
    inserted: Object.freeze(op.inserted.map((value) => admit_projected_value(value))),
    prev: must_projected_array(op.prev),
    next: must_projected_array(op.next),
  });
  if (op.kind === "rename") return Object.freeze({
    kind: op.kind, path, from: op.from, to: op.to,
    prev: must_projected_object(op.prev), next: must_projected_object(op.next),
  });
  if (op.kind === "move") return Object.freeze({
    kind: op.kind, path, from: op.from, to: op.to,
    prev: must_projected_array(op.prev), next: must_projected_array(op.next),
  });
  return Object.freeze({ kind: op.kind, path, prev: optional_projected(op.prev), next: admit_projected_value(op.next) });
}

function encode_hosted_graph_operation(operation: LiveMapGraphOp | LiveMapProjectedGraphEnsureQuidOp, portable = false): string {
  let representation: Record<string, unknown>;
  if (operation.op === "replace-root") {
    representation = { domain: "graph", op: operation.op, mode: operation.mode, root: encode_exact_hson_value(portable ? clone_hson_graph_without_quids(operation.root) : operation.root) };
  } else {
    const target = encode_target(operation.target, portable);
    if (operation.op === "set-attr") representation = { domain: "graph", op: operation.op, target, name: operation.name, value: encode_projected_json(operation.value as JsonValue) };
    else if (operation.op === "remove-attr") representation = { domain: "graph", op: operation.op, target, name: operation.name };
    else if (operation.op === "replace-attrs") representation = { domain: "graph", op: operation.op, target, attrs: encode_projected_json(operation.attrs as JsonValue) };
    else if (operation.op === "ensure-quid") {
      if (portable) throw incompatible_graph();
      representation = { domain: "graph", op: operation.op, target, quid: operation.quid };
    }
    else if (operation.op === "replace-content") {
      if (portable && operation.lineage === undefined) throw new HostedAggregateRepresentationError("Legacy replacement has no portable lineage.");
      const content = portable && is_Node(operation.replacement) ? clone_hson_graph_without_quids(operation.replacement) : operation.replacement;
      representation = { domain: "graph", op: operation.op, target, index: operation.index, replacement: encode_exact_hson_value(content), lineage: operation.lineage };
    }
    else if (operation.op === "insert-content") {
      const content = portable && is_Node(operation.content) ? clone_hson_graph_without_quids(operation.content) : operation.content;
      representation = { domain: "graph", op: operation.op, target, index: operation.index, content: encode_exact_hson_value(content) };
    }
    else if (operation.op === "remove-content") representation = { domain: "graph", op: operation.op, target, index: operation.index };
    else representation = { domain: "graph", op: operation.op, target, from: operation.from, to: operation.to };
  }
  return JSON.stringify(representation);
}

function decode_hosted_graph_operation(payload: string, mode: LiveMapRootMode, portable = false): LiveMapGraphOp | LiveMapProjectedGraphEnsureQuidOp {
  let value: unknown;
  try { value = JSON.parse(payload); } catch (cause) {
    throw new HostedAggregateRepresentationError("Hosted graph operation payload is malformed.", undefined, { cause });
  }
  const record = exact_record(value, "Hosted graph operation");
  if (record.domain !== "graph" || typeof record.op !== "string") throw new HostedAggregateRepresentationError("Hosted graph operation discriminant is malformed.");
  if (record.op === "replace-root") {
    exact_keys(record, ["domain", "op", "mode", "root"], "Hosted graph operation");
    if (mode !== "document" || record.mode !== "document" || typeof record.root !== "string") throw incompatible_graph();
    const root = decode_exact_hson_value(record.root);
    if (!is_Node(root)) throw incompatible_graph();
    if (portable) admit_portable_hson_node(root, "hosted client graph operation");
    return Object.freeze({ domain: "graph", op: "replace-root", mode: "document", root });
  }
  const target = decode_target(record.target, mode, portable);
  if (record.op === "set-attr") {
    exact_keys(record, ["domain", "op", "target", "name", "value"], "Hosted graph operation");
    if (mode !== "document" || typeof record.name !== "string" || typeof record.value !== "string") throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, name: record.name, value: decode_attr_value(record.value) });
  }
  if (record.op === "remove-attr") {
    exact_keys(record, ["domain", "op", "target", "name"], "Hosted graph operation");
    if (mode !== "document" || typeof record.name !== "string") throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, name: record.name });
  }
  if (record.op === "replace-attrs") {
    exact_keys(record, ["domain", "op", "target", "attrs"], "Hosted graph operation");
    if (mode !== "document" || typeof record.attrs !== "string") throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, attrs: decode_attrs(record.attrs) });
  }
  if (record.op === "ensure-quid") {
    if (portable) throw incompatible_graph();
    exact_keys(record, ["domain", "op", "target", "quid"], "Hosted graph operation");
    if (typeof record.quid !== "string") throw incompatible_graph();
    return mode === "document"
      ? Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, quid: record.quid })
      : Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapProjectedIdentityCommitTarget, quid: record.quid });
  }
  if (record.op === "replace-content" || record.op === "insert-content") {
    const field = record.op === "replace-content" ? "replacement" : "content";
    exact_keys(record, record.op === "replace-content"
      ? ["domain", "op", "target", "index", field, "lineage"]
      : ["domain", "op", "target", "index", field], "Hosted graph operation");
    if (mode !== "document" || !valid_index(record.index) || typeof record[field] !== "string") throw incompatible_graph();
    const content = decode_exact_hson_value(record[field] as string);
    if (portable && is_Node(content)) admit_portable_hson_node(content, "hosted client graph operation");
    return record.op === "replace-content"
      ? Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, index: record.index, replacement: content, lineage: normalize_replacement_lineage(record.lineage) })
      : Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, index: record.index, content });
  }
  if (record.op === "remove-content") {
    exact_keys(record, ["domain", "op", "target", "index"], "Hosted graph operation");
    if (mode !== "document" || !valid_index(record.index)) throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, index: record.index });
  }
  if (record.op === "move-content") {
    exact_keys(record, ["domain", "op", "target", "from", "to"], "Hosted graph operation");
    if (mode !== "document" || !valid_index(record.from) || !valid_index(record.to)) throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, from: record.from, to: record.to });
  }
  throw incompatible_graph();
}

function encode_target(target: LiveMapDocumentCommitTarget | LiveMapProjectedIdentityCommitTarget, portable = false): object {
  return {
    kind: "path",
    path: [...must_path(target.path)],
    ...("projected" in target ? { projected: true } : {}),
    ...(!portable && !("projected" in target) && target.witness !== undefined ? { witness: { quid: target.witness.quid } } : {}),
  };
}

function decode_target(input: unknown, mode: LiveMapRootMode, portable = false): LiveMapDocumentCommitTarget | LiveMapProjectedIdentityCommitTarget {
  const record = exact_record(input, "Hosted graph target");
  const path = must_path(record.path);
  if (mode !== "document") {
    exact_keys(record, ["kind", "path", "projected"], "Hosted projected graph target");
    if (record.kind !== "path" || record.projected !== true) throw incompatible_graph();
    return Object.freeze({ kind: "path", path, projected: true });
  }
  if (record.kind !== "path" || Object.hasOwn(record, "projected")) throw incompatible_graph();
  if (portable && record.witness !== undefined) throw incompatible_graph();
  if (record.witness === undefined) {
    exact_keys(record, ["kind", "path"], "Hosted document graph target");
    return Object.freeze({ kind: "path", path: must_document_path(path) });
  }
  exact_keys(record, ["kind", "path", "witness"], "Hosted document graph target");
  const witness = exact_record(record.witness, "Hosted document graph witness");
  exact_keys(witness, ["quid"], "Hosted document graph witness");
  if (typeof witness.quid !== "string") throw incompatible_graph();
  return Object.freeze({ kind: "path", path: must_document_path(path), witness: Object.freeze({ quid: witness.quid }) });
}

function encode_projected_json(value: JsonValue): string {
  return encode_livemap_replay_transport([Object.freeze({ kind: "replace", path: Object.freeze([]), prev: admit_projected_value(value), next: admit_projected_value(value) })]).payload;
}

function decode_attrs(payload: string): LiveMapDocumentAttrs {
  const operation = decode_livemap_replay_payload(payload)[0];
  if (operation?.kind !== "replace" || !is_ordered_projected_object(operation.next)) throw incompatible_graph();
  return materialize_projected_value(operation.next) as LiveMapDocumentAttrs;
}

function decode_attr_value(payload: string): LiveMapDocumentAttributeValue {
  const operation = decode_livemap_replay_payload(payload)[0];
  if (operation?.kind !== "replace") throw incompatible_graph();
  return materialize_projected_value(operation.next) as LiveMapDocumentAttributeValue;
}

function optional_projected(value: JsonValue | undefined): OrderedProjectedValue | undefined {
  return value === undefined ? undefined : admit_projected_value(value);
}

function must_projected_array(value: JsonValue): readonly OrderedProjectedValue[] {
  const projected = admit_projected_value(value);
  if (!Array.isArray(projected)) throw new HostedAggregateRepresentationError("Hosted data operation requires an array value.");
  return projected;
}

function must_projected_object(value: JsonValue): OrderedProjectedObject {
  const projected = admit_projected_value(value);
  if (!is_ordered_projected_object(projected)) throw new HostedAggregateRepresentationError("Hosted data operation requires an object value.");
  return projected;
}

function registry_canonical_text(entries: readonly HostedRegistryEntry[]): string {
  return JSON.stringify({
    format: HOSTED_REGISTRY_FORMAT,
    libraries: entries.map((entry) => ({
      name: entry.name,
      ...(entry.scope === undefined ? {} : { scope: entry.scope }),
      mode: entry.mode,
      schema: entry.schema,
      schemaDigest: entry.schemaDigest,
      rootCodec: entry.rootCodec,
    })),
  });
}

/** Complete-topology legacy bootstrap can verify only an all-included live projection. @internal */
export function complete_hosted_registry_as_projected_digest_internal(registry: HostedRegistry): string {
  const application = registry.libraries.filter((entry) => entry.scope === undefined).sort((a, b) => a.name.localeCompare(b.name));
  const system = registry.libraries.filter((entry) => entry.scope === "hson-internal");
  return hosted_sha256(registry_canonical_text([...application, ...system]));
}

function must_library_name(name: string): void {
  if (typeof name !== "string" || name.length === 0 || encoder.encode(name).byteLength > HOSTED_MAX_LIBRARY_NAME_BYTES) {
    throw new HostedAggregateRepresentationError("Hosted Library name is empty or exceeds its UTF-8 byte bound.");
  }
}

function assert_encoded_bound(value: unknown, maximum: number, label: string): void {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch (cause) {
    throw new HostedAggregateRepresentationError(`${label} is not serializable.`, undefined, { cause });
  }
  if (encoder.encode(encoded).byteLength > maximum) {
    throw new HostedAggregateRepresentationError(`${label} exceeds its encoded byte bound.`);
  }
}

function exact_record(value: unknown, label: string, operationIndex?: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostedAggregateRepresentationError(`${label} is not an object.`, operationIndex);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new HostedAggregateRepresentationError(`${label} has an unsupported prototype.`, operationIndex);
  }
  return value as Record<string, unknown>;
}

function exact_keys(record: Record<string, unknown>, keys: readonly string[], label: string, operationIndex?: number): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw new HostedAggregateRepresentationError(`${label} contains missing or unexpected fields.`, operationIndex);
  }
}

function must_path(value: unknown): LivePath {
  if (!Array.isArray(value)) throw new HostedAggregateRepresentationError("Hosted operation path is not an array.");
  for (const part of value) {
    if (typeof part === "string") continue;
    if (valid_index(part)) continue;
    throw new HostedAggregateRepresentationError("Hosted operation path contains an invalid segment.");
  }
  return Object.freeze([...value]) as LivePath;
}

function valid_index(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function valid_revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function must_document_path(path: LivePath): import("../../types/livemap.types.js").LiveMapDocumentPath {
  if (!path.every((part): part is number => typeof part === "number")) throw incompatible_graph();
  return validate_document_path(path);
}

function incompatible_graph(): HostedAggregateRepresentationError {
  return new HostedAggregateRepresentationError("Hosted graph operation is incompatible with its registry mode or malformed.");
}

function hosted_identity(label: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `${label}-${uuid}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${label}-${Date.now().toString(36)}-${random}`;
}

/** Small universal synchronous SHA-256 used only for deterministic internal registry fingerprints. */
export function hosted_sha256(text: string): string {
  const bytes = encoder.encode(text);
  const length = bytes.length;
  const paddedLength = (((length + 9 + 63) >> 6) << 6);
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bits / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bits >>> 0, false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const k = SHA256_K;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const x = w[index - 15]!, y = w[index - 2]!;
      const s0 = (right(x, 7) ^ right(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (right(y, 17) ^ right(y, 19) ^ (y >>> 10)) >>> 0;
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (right(e!, 6) ^ right(e!, 11) ^ right(e!, 25)) >>> 0;
      const ch = ((e! & f!) ^ (~e! & g!)) >>> 0;
      const t1 = (hh! + s1 + ch + k[index]! + w[index]!) >>> 0;
      const s0 = (right(a!, 2) ^ right(a!, 13) ^ right(a!, 22)) >>> 0;
      const maj = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a!) >>> 0; h[1] = (h[1]! + b!) >>> 0;
    h[2] = (h[2]! + c!) >>> 0; h[3] = (h[3]! + d!) >>> 0;
    h[4] = (h[4]! + e!) >>> 0; h[5] = (h[5]! + f!) >>> 0;
    h[6] = (h[6]! + g!) >>> 0; h[7] = (h[7]! + hh!) >>> 0;
  }
  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function right(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
