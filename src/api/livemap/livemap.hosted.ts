import { INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME } from "../../internal/interaction-storage.js";
import { assert_hson_identifier_name } from "../../core/hson-name.js";
import { is_flat_document_effect, validate_flat_document_effect, type DocumentFlatEffect } from "./livemap.document.flat-effects.js";
import { decode_document_scoped_library, own_document_scopes, own_topology_document_scopes } from "./livemap.document.scoped-portable.js";
import { decode_document_scoped_operation, scoped_effect_matches_operation, portable_document_scoped_effect, encode_document_scoped_effects, validate_document_scoped_effects, type DocumentScopedEffect } from "./livemap.document.scoped-effects.js";
import type { DocumentGraphOp } from "./livemap.document.lineage.js";
import { clone_node } from "../../core/clone-node.js";
import { own_commit_description } from "./livemap.commit-description.js";
import { own_data_library_validation, assert_data_library_validation, validate_data_library } from "./livemap.parts.js";
import { assert_portable_document_css_correspondence, decode_document_quads, own_document_quads } from "./livemap.document.quad.js";
import { hson_schema_digest, hson_schema_source_digest } from "../schema/hson-schema.js";
import { sha256_sync } from "../../core/sha256-sync.js";
import type { PortableAggregateSnapshot } from "./livemap.hosted.internal.types.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { decode_public_attrs } from "../../core/public-attrs.js";
import { is_Node } from "../../core/node-guards.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
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
  LiveMapLibraryAddOperation,
  LiveMapRootMode,
  HostedLiveMapSnapshot,
  LiveMapSnapshot,
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
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import { canonical_portable_document_css_op, assert_subject_free_portable_css_operation } from "../../internal/css/portable-document-operations.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "./livemap.hosted-limits.internal.js";
export { HOSTED_MAX_SNAPSHOT_BYTES } from "./livemap.hosted-limits.internal.js";

export const HOSTED_REGISTRY_FORMAT = "hson-hosted-registry" as const;
export const HOSTED_COMMIT_FORMAT = "hson-hosted-commit" as const;
export const LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT = "hson-livemap-libraries-snapshot" as const;
export const HOSTED_GRAPH_OP_FORMAT = "hson-hosted-graph-op" as const;
export const HOSTED_CLIENT_GRAPH_OP_FORMAT = "hson-hosted-client-graph-op" as const;
export const PORTABLE_AGGREGATE_COMMIT_FORMAT = "hson-portable-aggregate-commit" as const;
export const PORTABLE_AGGREGATE_SNAPSHOT_FORMAT = "hson-portable-aggregate-snapshot" as const;
export const HOSTED_ROOT_FORMAT = "hson-exact-value" as const;

export const HOSTED_MAX_LIBRARIES = 1_024;
export const HOSTED_MAX_LIBRARY_NAME_BYTES = 1_024;
export const HOSTED_MAX_OPERATIONS = 100_000;
export const HOSTED_MAX_COMMIT_BYTES = 16 * 1_024 * 1_024;
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
  /** Portable internal data-Library contract. @internal */
  validation?: "hson-part-collection-v1";
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
  /** Portable internal data-Library contract. @internal */
  validation?: "hson-part-collection-v1";
}>;

export type HostedSemanticOperation = Readonly<{
  library: string;
  operation: LiveMapAnyOp | import("../../types/livemap.types.js").LiveMapCssOp;
}>;

export type HostedReplayOperation = Readonly<{
  library: string;
  /** Private complete document effect under the containing commit position. @internal */
  scoped?: DocumentScopedEffect;
  flat?: DocumentFlatEffect;
  domain: "data" | "graph" | "css";
  kind: string;
  format: "structural-json" | typeof HOSTED_GRAPH_OP_FORMAT | "hson-document-css-op";
  payload: string;
}>;

export type HostedAggregateCommit = Readonly<{
  format: typeof HOSTED_COMMIT_FORMAT;
  authority: HostedAuthorityFence;
  registryDigest: string;
  previousRegistryDigest?: string;
  topology?: LiveMapLibraryAddOperation;
  changed: boolean;
  prevRev: number;
  rev: number;
  operations: readonly HostedSemanticOperation[];
  replay: Readonly<{ operations: readonly HostedReplayOperation[] }>;
}>;

/** Replica-relevant effects at one authority revision, with no runtime QUID evidence. */
export type PortableAggregateOperation =
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
  }>
  | Readonly<{
    library: string;
    domain: "css";
    kind: import("../../types/livemap.types.js").LiveMapCssOp["kind"];
    format: "hson-document-css-op";
    payload: string;
  }>;

export type PortableAggregateCommit = Readonly<{
  format: typeof PORTABLE_AGGREGATE_COMMIT_FORMAT;
  authority: HostedAuthorityFence;
  registryDigest: string;
  previousRegistryDigest?: string;
  topology?: LiveMapLibraryAddOperation;
  prevRev: number;
  rev: number;
  operations: readonly PortableAggregateOperation[];
}>;

/** Complete scoped evidence within the existing hosted position and wire envelope. */
export type PrivateScopedAggregateOperation = PortableAggregateOperation | Readonly<{
  library: string;
  domain: "document";
  effect: DocumentScopedEffect | DocumentFlatEffect;
}>;
/** @internal */
export type PrivateScopedAggregateCommit = Readonly<{
  authority: HostedAuthorityFence;
  registryDigest: string;
  prevRev: number;
  rev: number;
  /** Completeness bound only; never a replay cursor or receipt authority. */
  operationCount: number;
  operations: readonly PrivateScopedAggregateOperation[];
}>;

export type DecodedHostedOperation = Readonly<{
  library: HostedRegistryBinding;
  semantic: LiveMapAnyOp | import("../../types/livemap.types.js").LiveMapCssOp;
  projected?: LiveMapProjectedDataOp;
  graph?: DocumentGraphOp | LiveMapProjectedGraphEnsureQuidOp;
  css?: import("../../types/livemap.types.js").LiveMapCssOp;
}>;

export class HostedAggregateRepresentationError extends Error {
  constructor(message: string, readonly operationIndex?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostedAggregateRepresentationError";
  }
}

export function make_hosted_registry(bindings: readonly HostedRegistryBinding[]): HostedRegistry {
  if (bindings.length > HOSTED_MAX_LIBRARIES) {
    throw new HostedAggregateRepresentationError("Hosted registry library count is outside its supported bound.");
  }
  const names = new Set<string>();
  const libraries = bindings.map((binding): HostedRegistryEntry => {
    const { name, scope, mode, schema } = binding;
    const validation = own_data_library_validation(binding);
    assert_data_library_validation(validation, mode, scope);
    must_library_name(name, scope);
    if (names.has(name)) throw new HostedAggregateRepresentationError(`Hosted Library name ${JSON.stringify(name)} is duplicated.`);
    names.add(name);
    if (scope !== undefined && scope !== "hson-internal") {
      throw new HostedAggregateRepresentationError("Hosted registry Library scope is malformed.");
    }
    if (mode !== "data-object" && mode !== "data-array" && mode !== "data-string" && mode !== "data-number" && mode !== "data-boolean" && mode !== "data-null" && mode !== "document") {
      throw new HostedAggregateRepresentationError("Hosted registry contains an unsupported root mode.");
    }
    if (typeof schema !== "object" || schema === null) throw new HostedAggregateRepresentationError("Hosted registry Schema source is malformed.");
    const source = schema.toHson();
    return Object.freeze({
      name,
      ...(scope === undefined ? {} : { scope }),
      mode,
      schema: source,
      schemaDigest: hson_schema_digest(schema),
      ...(validation === undefined ? {} : { validation }),
      rootCodec: HOSTED_ROOT_FORMAT,
    });
  });
  return registry_from_entries(libraries);
}

/** Build a detached registry from validated semantic contract entries, defensively checking attached source. @internal */
export function registry_from_entries(entries: readonly HostedRegistryEntry[]): HostedRegistry {
  for (const entry of entries) {
    assert_data_library_validation(own_data_library_validation(entry), entry.mode, entry.scope, entry.schema);
    if (hson_schema_source_digest(entry.schema) !== entry.schemaDigest) {
      throw new HostedAggregateRepresentationError("Hosted registry Schema identity disagrees with its validated definition.");
    }
  }
  const libraries = Object.freeze(entries.map(entry => {
    const validation = own_data_library_validation(entry);
    return Object.freeze({ ...entry, ...(validation === undefined ? {} : { validation }) });
  }));
  return Object.freeze({
    format: HOSTED_REGISTRY_FORMAT,
    libraries,
    digest: sha256_sync(registry_canonical_text(libraries)),
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
      operation: LiveMapAnyOp | import("../../types/livemap.types.js").LiveMapCssOp;
      projected?: LiveMapProjectedDataOp;
      /** @internal */
      scoped?: DocumentScopedEffect;
      flat?: DocumentFlatEffect;
    }>[];
  }>,
): HostedAggregateCommit {
  if (input.operations.length > HOSTED_MAX_OPERATIONS) {
    throw new HostedAggregateRepresentationError("Hosted commit operation count exceeds its supported bound.");
  }
  const semantic: HostedSemanticOperation[] = [];
  const replay: HostedReplayOperation[] = [];
  const scopedByLibrary = new Map<string, DocumentScopedEffect[]>();
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
      : evidence.domain === "css" ? decode_hosted_css_operation(evidence.payload, binding.mode)
      : decode_hosted_graph_operation(evidence.payload, binding.mode);
    semantic.push(Object.freeze({ library: binding.name, operation }));
    if (entry.scoped !== undefined) {
      if (binding.mode !== "document" || !("domain" in entry.operation)
        || (entry.operation.domain !== "graph" && entry.operation.domain !== "css")
        || entry.operation.domain === "graph" && entry.operation.op === "ensure-quid"
        || !scoped_effect_matches_operation(entry.scoped, entry.operation)) {
        throw new HostedAggregateRepresentationError("Scoped document operation and Library evidence disagree.");
      }
      const effects = scopedByLibrary.get(binding.name) ?? [];
      if (entry.scoped.ordinal !== effects.length || effects.length > 0 && effects.at(-1)?.after !== entry.scoped.before) {
        throw new HostedAggregateRepresentationError("Scoped document operation order is inconsistent.");
      }
      effects.push(entry.scoped); scopedByLibrary.set(binding.name, effects);
      replay.push(Object.freeze({ ...evidence, scoped: entry.scoped }));
    } else {
      if (scopedByLibrary.has(binding.name)) throw new HostedAggregateRepresentationError("Missing complete scoped document evidence.");
      replay.push(Object.freeze({ ...evidence, ...(entry.flat === undefined ? {} : { flat: entry.flat }) }));
    }
  }
  for (const [library, effects] of scopedByLibrary) {
    // Validate the shared incremental representation, including contiguous ordinals.
    const captured = validate_document_scoped_effects(encode_document_scoped_effects(effects));
    let ordinal = 0;
    for (let index = 0; index < replay.length; index++) {
      const entry = replay[index]!;
      if (entry.library === library && entry.scoped !== undefined) replay[index] = Object.freeze({ ...entry, scoped: captured[ordinal++]! });
    }
  }
  // Hosted codecs normalize a separate semantic/replay representation. Own that
  // complete description before gates, authority listeners or returns share it.
  const commit = own_commit_description<HostedAggregateCommit>({
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

/** Own portable topology before serialization can reenter through caller callbacks. */
function capture_part_topology(topology: LiveMapLibraryAddOperation): LiveMapLibraryAddOperation {
  // Preserve the exact descriptor capture, including its own contract evidence.
  // The established clone also supports runtimes without structuredClone.
  const captured = admit_projected_value(topology);
  const detached = clone_node(topology);
  if (!ordered_projected_value_equal(captured, admit_projected_value(detached))) {
    throw new HostedAggregateRepresentationError("Topology changed during exact capture.");
  }
  const freeze = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(detached);
  for (const entry of detached.operation.libraries) {
    const scopes = own_topology_document_scopes(entry);
    if (scopes !== undefined) decode_document_scoped_library({ root: decode_hosted_root(entry.root), scopes, css: entry.css });
    const validation = own_data_library_validation(entry);
    if (validation !== undefined) validate_data_library(decode_hosted_root(entry.root, HOSTED_MAX_SNAPSHOT_BYTES), entry.mode, validation);
  }
  return detached;
}

/** Wrap the ordinary LiveMap library-add semantic operation in hosted revision fences. */
export function make_hosted_topology_commit(
  fence: HostedAuthorityFence,
  previous: HostedRegistry,
  resulting: HostedRegistry,
  topology: LiveMapLibraryAddOperation,
  prevRev: number,
): HostedAggregateCommit {
  if (topology.operation.kind !== "library-add" || topology.operation.libraries.length === 0
    || topology.operation.libraries[0]?.name !== topology.library
    || !valid_revision(prevRev)) {
    throw new HostedAggregateRepresentationError("Hosted topology transition is malformed.");
  }
  topology = capture_part_topology(topology);
  const commit: HostedAggregateCommit = Object.freeze({
    format: HOSTED_COMMIT_FORMAT,
    authority: fence,
    previousRegistryDigest: previous.digest,
    registryDigest: resulting.digest,
    topology,
    changed: true,
    prevRev,
    rev: prevRev + 1,
    operations: Object.freeze([]),
    replay: Object.freeze({ operations: Object.freeze([]) }),
  });
  assert_encoded_bound(commit, HOSTED_MAX_COMMIT_BYTES, "Hosted topology commit");
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
    const operation = semantic.operation as LiveMapAnyOp | import("../../types/livemap.types.js").LiveMapCssOp;
    if (evidence.domain === "css") {
      const css = decode_hosted_css_operation(String(evidence.payload), binding.mode);
      const expected = encode_hosted_operation(binding.name, binding.mode, css);
      if (evidence.kind !== css.kind || evidence.format !== expected.format
        || evidence.payload !== expected.payload || !hosted_semantic_equal(operation, css)) {
        throw new HostedAggregateRepresentationError("Hosted CSS operation and evidence disagree.", index);
      }
      return Object.freeze({ library: binding, semantic: css, css });
    }
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

/** Encode immutable authoritative evidence independently of a pending transition.
 * No authorization projection or live Library state participates. Disposable CSS
 * labels are alpha-renamed so runtime QUID values never enter durable storage. @internal */
export function encode_authoritative_scoped_commit(authority: HostedAggregateCommit): PrivateScopedAggregateCommit {
  if (authority.topology !== undefined || authority.operations.length !== authority.replay.operations.length
    || !authority.changed || authority.rev !== authority.prevRev + 1) {
    throw new HostedAggregateRepresentationError("Incomplete authoritative scoped commit evidence.");
  }
  const operations: PrivateScopedAggregateOperation[] = [];
  const batches = new Map<string, DocumentScopedEffect[]>();
  const flat = new Map<string, DocumentFlatEffect>();
  for (const entry of authority.replay.operations) {
    if (entry.flat === undefined) continue;
    if (flat.has(entry.library)) throw incompatible_graph();
    const effect = validate_flat_document_effect(entry.flat);
    const graphs = authority.operations.filter(operation => operation.library === entry.library)
      .flatMap(({ operation }) => "domain" in operation && operation.domain === "graph" && operation.op !== "ensure-quid"
        ? [encode_scoped_effect_graph_operation(operation)] : []);
    if (JSON.stringify(graphs) !== JSON.stringify(effect.graphs)) throw incompatible_graph();
    flat.set(entry.library, effect);
  }
  const emittedFlat = new Set<string>();
  for (const [index, evidence] of authority.replay.operations.entries()) {
    const semantic = authority.operations[index]!;
    if (semantic.library !== evidence.library) throw incompatible_graph();
    const flatEffect = flat.get(evidence.library);
    if (flatEffect !== undefined) {
      if (evidence.scoped !== undefined || batches.has(evidence.library)) throw incompatible_graph();
      if (!emittedFlat.has(evidence.library)) operations.push({ library: evidence.library, domain: "document", effect: flatEffect });
      emittedFlat.add(evidence.library);
      continue;
    }
    if (evidence.scoped === undefined) {
      if (batches.has(evidence.library)) throw new HostedAggregateRepresentationError("Missing scoped document evidence.");
      const ordinary = make_portable_aggregate_commit({ ...authority, operations: [semantic], replay: { operations: [evidence] } });
      if (ordinary !== undefined) operations.push(...ordinary.operations);
      continue;
    }
    if (!("domain" in semantic.operation) || evidence.domain !== semantic.operation.domain
      || (semantic.operation.domain !== "graph" && semantic.operation.domain !== "css")
      || semantic.operation.domain === "graph" && semantic.operation.op === "ensure-quid"
      || !scoped_effect_matches_operation(evidence.scoped, semantic.operation)) throw incompatible_graph();
    const effect = portable_document_scoped_effect(evidence.scoped);
    const batch = batches.get(evidence.library) ?? [];
    if (effect.ordinal !== batch.length) throw new HostedAggregateRepresentationError("Missing complete scoped evidence in authoritative transaction.");
    if (batch.length > 0 && batch.at(-1)!.after !== effect.before) throw incompatible_graph();
    batch.push(effect); batches.set(evidence.library, batch);
    operations.push({ library: evidence.library, domain: "document", effect });
  }
  for (const batch of batches.values()) {
    validate_document_scoped_effects(encode_document_scoped_effects(batch));
  }
  // Own and recursively freeze the portable representation, not the source's
  // runtime evidence. This encoder also works after preparation has ended.
  const result: PrivateScopedAggregateCommit = JSON.parse(JSON.stringify({ authority: authority.authority,
    registryDigest: authority.registryDigest, prevRev: authority.prevRev, rev: authority.rev,
    operationCount: operations.length, operations }));
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.values(value).forEach(freeze); Object.freeze(value);
  };
  freeze(result);
  assert_encoded_bound(result, HOSTED_MAX_COMMIT_BYTES, "Authoritative scoped commit");
  return result;
}

/** Complete source-free topology for durable authority, never public transport. @internal */
export function encode_authoritative_topology_commit(authority: HostedAggregateCommit): Omit<PortableAggregateCommit, "format"> {
  if (authority.topology === undefined) throw new HostedAggregateRepresentationError("Missing topology evidence.");
  const topology = capture_part_topology(authority.topology);
  for (const entry of topology.operation.libraries) {
    if (own_topology_document_scopes(entry) === undefined && entry.css !== undefined) {
      assert_portable_document_css_correspondence(decode_hosted_root(entry.root), entry.mode, own_document_quads(entry), entry.css);
    }
  }
  if (authority.previousRegistryDigest === undefined || authority.operations.length !== 0
    || authority.replay.operations.length !== 0 || !authority.changed
    || authority.rev !== authority.prevRev + 1) {
    throw new HostedAggregateRepresentationError("Hosted topology commit evidence is inconsistent.");
  }
  const commit = Object.freeze({ authority: authority.authority, previousRegistryDigest: authority.previousRegistryDigest,
    registryDigest: authority.registryDigest, topology, prevRev: authority.prevRev, rev: authority.rev, operations: Object.freeze([]) });
  assert_encoded_bound(commit, HOSTED_MAX_COMMIT_BYTES, "Authoritative topology commit");
  return commit;
}

/** Derive QUID-free semantic effects from a living authority transition. */
export function make_portable_aggregate_commit(authority: HostedAggregateCommit): PortableAggregateCommit | undefined {
  if (authority.replay.operations.some(entry => entry.scoped !== undefined || entry.flat !== undefined)) {
    throw new HostedAggregateRepresentationError("Scoped document delivery requires coordinated Echo support.");
  }
  if (authority.topology !== undefined) {
    if (authority.topology.operation.libraries.some(entry => own_document_scopes(entry) !== undefined)) {
      throw new HostedAggregateRepresentationError("Scoped document delivery requires coordinated Echo support.");
    }
    const commit = Object.freeze({ format: PORTABLE_AGGREGATE_COMMIT_FORMAT, ...encode_authoritative_topology_commit(authority) });
    assert_encoded_bound(commit, HOSTED_MAX_COMMIT_BYTES, "Hosted topology commit");
    return commit;
  }
  const operations: PortableAggregateCommit["operations"][number][] = [];
  for (let index = 0; index < authority.operations.length; index += 1) {
    const entry = authority.operations[index];
    const evidence = authority.replay.operations[index];
    if (entry === undefined || evidence === undefined || entry.library !== evidence.library) {
      throw new HostedAggregateRepresentationError("Authority history operation evidence is incomplete.");
    }
    const operation = entry.operation;
    if ("domain" in operation && operation.domain === "graph" && operation.op === "ensure-quid") continue;
    if (evidence.domain === "css") {
      if (!("domain" in operation) || operation.domain !== "css") throw new HostedAggregateRepresentationError("Authority CSS operation domains disagree.");
      assert_subject_free_portable_css_operation(operation);
      operations.push(Object.freeze({ library: entry.library, domain: "css", kind: operation.kind,
        format: "hson-document-css-op", payload: evidence.payload }));
      continue;
    }
    if (evidence.domain === "data") {
      if ("domain" in operation) throw new HostedAggregateRepresentationError("Authority history operation domains disagree.");
      operations.push(Object.freeze({ library: entry.library, domain: "data", kind: operation.kind, format: "structural-json", payload: evidence.payload }));
      continue;
    }
    if (!("domain" in operation) || operation.domain !== "graph" || evidence.domain !== "graph") {
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
  const commit: PortableAggregateCommit = Object.freeze({
    format: PORTABLE_AGGREGATE_COMMIT_FORMAT,
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
export function decode_portable_aggregate_commit(
  input: PortableAggregateCommit,
  registry: HostedRegistry,
  bindingsByName: ReadonlyMap<string, HostedRegistryBinding>,
): readonly DecodedHostedOperation[] {
  const record = exact_record(input, "Hosted client commit");
  exact_keys(record, ["format", "authority", "registryDigest", "prevRev", "rev", "operations"], "Hosted client commit");
  const authority = exact_record(record.authority, "Hosted client commit authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted client commit authority");
  if (record.format !== PORTABLE_AGGREGATE_COMMIT_FORMAT || record.registryDigest !== registry.digest
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
    if (evidence.domain === "css") {
      if (evidence.format !== "hson-document-css-op" || binding.mode !== "document") throw incompatible_graph();
      const css = decode_hosted_css_operation(evidence.payload, binding.mode);
      assert_subject_free_portable_css_operation(css);
      if (css.kind !== evidence.kind || JSON.stringify(css) !== evidence.payload) {
        throw new HostedAggregateRepresentationError("Hosted client CSS operation is noncanonical.", index);
      }
      return Object.freeze({ library: binding, semantic: css, css });
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

/** Decode at the private managed Echo or full-map durable authority boundary.
 * Membership is resolved from the owner's fixed bindings, never effect contents.
 * Shape/semantic validation does not authorize receipt of this position. @internal */
export function decode_private_scoped_aggregate_commit(input: PrivateScopedAggregateCommit,
  registry: HostedRegistry, bindings: ReadonlyMap<string, HostedRegistryBinding>):
  readonly (DecodedHostedOperation & Readonly<{ scoped?: DocumentScopedEffect; flat?: DocumentFlatEffect }>)[] {
  const record = exact_record(input, "Private scoped commit");
  exact_keys(record, ["authority", "registryDigest", "prevRev", "rev", "operationCount", "operations"], "Private scoped commit");
  const authority = exact_record(record.authority, "Private scoped authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Private scoped authority");
  if (record.registryDigest !== registry.digest || !valid_revision(record.prevRev) || !valid_revision(record.rev) || record.rev !== record.prevRev + 1
    || typeof authority.logicalMapId !== "string" || !authority.logicalMapId
    || typeof authority.incarnationId !== "string" || !authority.incarnationId
    || !Array.isArray(record.operations) || !record.operations.length || record.operations.length > HOSTED_MAX_OPERATIONS
    || record.operationCount !== record.operations.length) {
    throw new HostedAggregateRepresentationError("Private scoped commit envelope is malformed.");
  }
  assert_encoded_bound(input, HOSTED_MAX_COMMIT_BYTES, "Private scoped commit");
  const effects = new Map<string, DocumentScopedEffect[]>();
  const flat = new Map<string, DocumentFlatEffect>();
  const ordinary: PortableAggregateOperation[] = [];
  for (const operation of input.operations) {
    const entry = exact_record(operation, "Private scoped operation");
    if (entry.domain !== "document") {
      // Flat Libraries retain ordinary effects. Once this Library gains scopes,
      // every subsequent document effect must retain that evidence.
      if (typeof entry.library === "string" && (effects.has(entry.library) || flat.has(entry.library))) {
        throw new HostedAggregateRepresentationError("Missing scoped document evidence.");
      }
      if (operation.domain === "document") throw incompatible_graph();
      ordinary.push(operation);
      continue;
    }
    exact_keys(entry, ["library", "domain", "effect"], "Private scoped operation");
    const binding = typeof entry.library === "string" ? bindings.get(entry.library) : undefined;
    if (binding === undefined || binding.mode !== "document" || binding.scope !== undefined) {
      throw new HostedAggregateRepresentationError("Scoped effect references an unauthorized document Library.");
    }
    const batch = effects.get(binding.name) ?? [];
    if (operation.domain !== "document") throw incompatible_graph();
    if (is_flat_document_effect(operation.effect)) {
      if (flat.has(binding.name) || batch.length || ordinary.some(item => item.library === binding.name)) throw incompatible_graph();
      flat.set(binding.name, validate_flat_document_effect(operation.effect));
      continue;
    }
    if (flat.has(binding.name)) throw incompatible_graph();
    batch.push(operation.effect);
    effects.set(binding.name, batch);
  }
  const validated = new Map([...effects].map(([name, batch]) =>
    [name, validate_document_scoped_effects(encode_document_scoped_effects(batch))]));
  const decoded = ordinary.length === 0 ? [] : decode_portable_aggregate_commit({
    format: PORTABLE_AGGREGATE_COMMIT_FORMAT, authority: input.authority, registryDigest: input.registryDigest,
    prevRev: input.prevRev, rev: input.rev, operations: ordinary,
  }, registry, bindings);
  let ordinaryIndex = 0;
  const ordinals = new Map<string, number>();
  return Object.freeze(input.operations.flatMap((operation): (DecodedHostedOperation & { scoped?: DocumentScopedEffect; flat?: DocumentFlatEffect })[] => {
    if (operation.domain !== "document") return [decoded[ordinaryIndex++]!];
    const flatEffect = flat.get(operation.library);
    if (flatEffect !== undefined) {
      const library = bindings.get(operation.library)!;
      const css: import("../../types/livemap.types.js").LiveMapCssOp = { domain: "css", kind: "replace", stylesheet: flatEffect.css };
      return [...flatEffect.graphs.map(payload => {
        const graph = decode_scoped_effect_graph_operation(payload);
        return { library, semantic: graph, graph };
      }), { library, semantic: css, css, flat: flatEffect }];
    }
    const ordinal = ordinals.get(operation.library) ?? 0;
    ordinals.set(operation.library, ordinal + 1);
    const scoped = validated.get(operation.library)![ordinal]!;
    const effectOperation = decode_document_scoped_operation(scoped.graph);
    return [Object.freeze({ library: bindings.get(operation.library)!, semantic: effectOperation,
      ...(effectOperation.domain === "css" ? { css: effectOperation } : { graph: effectOperation }), scoped })];
  }));
}

/** Project exact authority capture into the full, QUID-free Echo snapshot format. */
export function make_portable_aggregate_snapshot(authority: HostedLiveMapSnapshot): PortableAggregateSnapshot {
  assert_hosted_libraries_snapshot_shape(authority);
  const snapshot: PortableAggregateSnapshot = Object.freeze({
    format: PORTABLE_AGGREGATE_SNAPSHOT_FORMAT,
    revision: authority.revision,
    registry: authority.registry,
    registryDigest: authority.registryDigest,
    libraries: Object.freeze(authority.libraries.map((entry) => Object.freeze({
      ...entry,
      root: encode_hosted_root(clone_hson_graph_without_quids(decode_hosted_root(entry.root))),
    }))),
    authority: authority.authority,
  });
  assert_portable_aggregate_snapshot_shape(snapshot);
  return snapshot;
}

/** Reject all identity claims in a remote client snapshot before runtime installation. */
export function assert_portable_aggregate_snapshot_shape(snapshot: PortableAggregateSnapshot, scoped = false): void {
  const record = exact_record(snapshot, "Hosted client snapshot");
  exact_keys(record, ["format", "revision", "registry", "registryDigest", "libraries", "authority"], "Hosted client snapshot");
  const authority = exact_record(record.authority, "Hosted client snapshot authority");
  exact_keys(authority, ["logicalMapId", "incarnationId"], "Hosted client snapshot authority");
  if (record.format !== PORTABLE_AGGREGATE_SNAPSHOT_FORMAT || !valid_revision(record.revision)
    || typeof authority.logicalMapId !== "string" || !authority.logicalMapId
    || typeof authority.incarnationId !== "string" || !authority.incarnationId) {
    throw new HostedAggregateRepresentationError("Hosted client snapshot envelope is malformed.");
  }
  assert_libraries_snapshot_entries(record, scoped);
  if (snapshot.registryDigest !== snapshot.registry.digest
    || snapshot.libraries.length !== snapshot.registry.libraries.length) {
    throw new HostedAggregateRepresentationError("Hosted client snapshot registry is malformed.");
  }
  for (const entry of snapshot.libraries) admit_portable_hson_node(
    decode_hosted_root(entry.root, HOSTED_MAX_SNAPSHOT_BYTES), "hosted client snapshot");
  assert_encoded_bound(snapshot, HOSTED_MAX_SNAPSHOT_BYTES, "Hosted client snapshot");
}

/** Reuse the portable local installer while retaining a distinct client wire format. */
export function portable_aggregate_snapshot_as_local(snapshot: PortableAggregateSnapshot): LiveMapSnapshot {
  assert_portable_aggregate_snapshot_shape(snapshot);
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

export function encode_hosted_root(root: HsonNode, maxPayloadBytes?: number): Readonly<{ format: typeof HOSTED_ROOT_FORMAT; payload: string }> {
  return Object.freeze({ format: HOSTED_ROOT_FORMAT, payload: encode_exact_hson_value(root,
    maxPayloadBytes === undefined ? undefined : { maxPayloadBytes }) });
}

export function decode_hosted_root(input: unknown, maxPayloadBytes?: number): HsonNode {
  const record = exact_record(input, "Hosted root encoding");
  exact_keys(record, ["format", "payload"], "Hosted root encoding");
  if (record.format !== HOSTED_ROOT_FORMAT || typeof record.payload !== "string") {
    throw new HostedAggregateRepresentationError("Hosted root encoding is malformed.");
  }
  const root = decode_exact_hson_value(record.payload,
    maxPayloadBytes === undefined ? undefined : { maxPayloadBytes });
  if (!is_Node(root)) throw new HostedAggregateRepresentationError("Hosted root encoding does not contain a canonical root.");
  return root;
}

export function assert_libraries_snapshot_bound(snapshot: LiveMapSnapshot): void {
  assert_encoded_bound(snapshot, HOSTED_MAX_SNAPSHOT_BYTES, "Hosted aggregate snapshot");
}

export function assert_libraries_snapshot_shape(snapshot: LiveMapSnapshot): void {
  const record = exact_record(snapshot, "Hosted aggregate snapshot");
  exact_keys(record, ["format", "revision", "registry", "registryDigest", "libraries"], "Hosted aggregate snapshot");
  assert_libraries_snapshot_entries(record);
}

function assert_libraries_snapshot_entries(record: Readonly<Record<string, unknown>>, scoped = false): void {
  const registry = exact_record(record.registry, "Hosted snapshot registry");
  exact_keys(registry, ["format", "libraries", "digest"], "Hosted snapshot registry");
  if (registry.format !== HOSTED_REGISTRY_FORMAT
    || !Array.isArray(registry.libraries) || !Array.isArray(record.libraries)) {
    throw new HostedAggregateRepresentationError("Hosted snapshot Library sequences are malformed.");
  }
  for (const entry of registry.libraries) {
    const item = exact_record(entry, "Hosted registry entry");
    if (typeof item.name === "string") assert_library_identifier(item.name, item.scope);
    exact_keys(item, ["name", "mode", "schema", "schemaDigest", "rootCodec",
      ...(Object.hasOwn(item, "scope") ? ["scope"] : []), ...(Object.hasOwn(item, "validation") ? ["validation"] : [])], "Hosted registry entry");
    const scope = Object.getOwnPropertyDescriptor(item, "scope");
    if (scope !== undefined && scope.value !== "hson-internal") throw new HostedAggregateRepresentationError("Hosted registry Library scope is malformed.");
    assert_data_library_validation(own_data_library_validation(item), String(item.mode), scope?.value,
      typeof item.schema === "string" ? item.schema : "");
    if (entry.rootCodec !== HOSTED_ROOT_FORMAT
      || (entry.scope !== undefined && entry.scope !== "hson-internal")) {
      throw new HostedAggregateRepresentationError("Hosted registry Library scope is malformed.");
    }
  }
  for (const entry of record.libraries) {
    const item = exact_record(entry, "Hosted snapshot Library");
    exact_keys(item, entry.mode === "document"
      ? ["name", "mode", "schema", "schemaDigest", "root", "css", ...(Object.hasOwn(item, "quads") ? ["quads"] : []), ...(scoped && Object.hasOwn(item, "scopes") ? ["scopes"] : [])]
      : ["name", "mode", "schema", "schemaDigest", "root"], "Hosted snapshot Library");
    if (Object.hasOwn(item, "quads")) {
      if (item.quads === undefined) throw new HostedAggregateRepresentationError("Portable QUAD association cannot be undefined.");
      decode_document_quads(item.quads, decode_hosted_root(item.root, HOSTED_MAX_SNAPSHOT_BYTES), String(entry.mode));
    }
    const scopes = own_document_scopes(item);
    if (scopes !== undefined) decode_document_scoped_library({ root: decode_hosted_root(item.root, HOSTED_MAX_SNAPSHOT_BYTES), scopes, css: item.css });
    else if (entry.mode === "document") assert_portable_document_css_correspondence(
      decode_hosted_root(item.root, HOSTED_MAX_SNAPSHOT_BYTES), "document", own_document_quads(item),
      encode_portable_document_stylesheet(decode_portable_document_stylesheet(item.css)));
  }
  for (let index = 0; index < registry.libraries.length; index++) {
    const entry = exact_record(registry.libraries[index], "Hosted registry entry");
    const validation = own_data_library_validation(entry);
    if (validation === undefined) continue;
    const item = exact_record(record.libraries[index], "Part collection snapshot");
    if (item.name !== entry.name || item.mode !== entry.mode) throw new HostedAggregateRepresentationError("Part collection snapshot contract disagrees.");
    validate_data_library(decode_hosted_root(item.root, HOSTED_MAX_SNAPSHOT_BYTES), String(entry.mode), validation);
  }

}

export function assert_hosted_libraries_snapshot_shape(snapshot: HostedLiveMapSnapshot): void {
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

function encode_hosted_operation(name: string, mode: LiveMapRootMode, operation: LiveMapAnyOp | import("../../types/livemap.types.js").LiveMapCssOp): HostedReplayOperation {
  if (!("domain" in operation)) {
    if (mode === "document") throw new HostedAggregateRepresentationError("Data operation is incompatible with a document Library.");
    const projected = projected_operation_from_semantic(operation);
    const encoded = encode_livemap_replay_transport([projected]);
    return Object.freeze({ library: name, domain: "data", kind: operation.kind, format: encoded.format, payload: encoded.payload });
  }
  if (operation.domain === "css") {
    if (mode !== "document") throw new HostedAggregateRepresentationError("CSS operation requires a document Library.");
    const css = canonical_portable_document_css_op(operation);
    return Object.freeze({ library: name, domain: "css", kind: css.kind,
      format: "hson-document-css-op", payload: JSON.stringify(css) });
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

function decode_hosted_css_operation(payload: string, mode: LiveMapRootMode): import("../../types/livemap.types.js").LiveMapCssOp {
  if (mode !== "document" || typeof payload !== "string" || new TextEncoder().encode(payload).byteLength > HOSTED_MAX_COMMIT_BYTES) {
    throw new HostedAggregateRepresentationError("Hosted CSS operation is incompatible or oversized.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { throw new HostedAggregateRepresentationError("Hosted CSS operation is malformed."); }
  const css = canonical_portable_document_css_op(parsed);
  if (JSON.stringify(css) !== payload) throw new HostedAggregateRepresentationError("Hosted CSS operation is noncanonical.");
  return css;
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

function encode_hosted_graph_operation(operation: DocumentGraphOp | LiveMapProjectedGraphEnsureQuidOp, portable = false): string {
  let representation: Record<string, unknown>;
  if (operation.op === "replace-root") {
    representation = { domain: "graph", op: operation.op, mode: operation.mode, root: encode_exact_hson_value(portable ? clone_hson_graph_without_quids(operation.root) : operation.root) };
  } else {
    const target = encode_target(operation.target, portable);
    if (operation.op === "set-attr") representation = { domain: "graph", op: operation.op, target, name: operation.name, value: portable ? encode_projected_json(operation.value as JsonValue) : encode_effect_attrs({ [operation.name]: operation.value }) };
    else if (operation.op === "remove-attr") representation = { domain: "graph", op: operation.op, target, name: operation.name };
    else if (operation.op === "replace-attrs") representation = { domain: "graph", op: operation.op, target, attrs: portable ? encode_projected_json(operation.attrs as JsonValue) : encode_effect_attrs(operation.attrs) };
    else if (operation.op === "ensure-quid") {
      if (portable) throw incompatible_graph();
      representation = { domain: "graph", op: operation.op, target, quid: operation.quid };
    }
    else if (operation.op === "replace-content") {
      if (portable && operation.lineage === undefined) throw new HostedAggregateRepresentationError("Portable replacement requires lineage.");
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

function decode_hosted_graph_operation(payload: string, mode: LiveMapRootMode, portable = false): DocumentGraphOp | LiveMapProjectedGraphEnsureQuidOp {
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
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, name: record.name, value: portable ? decode_attr_value(record.value) : decode_effect_attr_value(record.value, record.name) });
  }
  if (record.op === "remove-attr") {
    exact_keys(record, ["domain", "op", "target", "name"], "Hosted graph operation");
    if (mode !== "document" || typeof record.name !== "string") throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, name: record.name });
  }
  if (record.op === "replace-attrs") {
    exact_keys(record, ["domain", "op", "target", "attrs"], "Hosted graph operation");
    if (mode !== "document" || typeof record.attrs !== "string") throw incompatible_graph();
    return Object.freeze({ domain: "graph", op: record.op, target: target as LiveMapDocumentCommitTarget, attrs: portable ? decode_attrs(record.attrs) : decode_effect_attrs(record.attrs) });
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

/** Accepted graph attribute effects require their actual style receiving context.
 * Client-authored portable operations retain their stricter projected codec. */
function encode_effect_attrs(attrs: LiveMapDocumentAttrs): string {
  return encode_exact_hson_value(Object.keys(attrs).length === 0
    ? { $_tag: "div", $_content: [] }
    : { $_tag: "div", $_content: [], $_attrs: attrs });
}

function decode_effect_attrs(payload: string): LiveMapDocumentAttrs {
  const carrier = decode_exact_hson_value(payload);
  if (!is_Node(carrier) || carrier.$_tag !== "div" || carrier.$_content.length !== 0
    || Object.keys(carrier).length !== (Object.hasOwn(carrier, "$_attrs") ? 3 : 2)) throw incompatible_graph();
  const attrs = decode_public_attrs(carrier.$_attrs ?? {});
  if (attrs === undefined) throw incompatible_graph();
  return attrs;
}

function decode_effect_attr_value(payload: string, name: string): LiveMapDocumentAttributeValue {
  const attrs = decode_effect_attrs(payload);
  if (Object.keys(attrs).length !== 1 || !Object.hasOwn(attrs, name)) throw incompatible_graph();
  return attrs[name];
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
      schemaDigest: entry.schemaDigest,
      ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }),
      rootCodec: entry.rootCodec,
    })),
  });
}

function assert_library_identifier(name: string, scope: unknown): void {
  if (scope === "hson-internal" && name === INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME) return;
  assert_hson_identifier_name(name, "Library");
}

function must_library_name(name: string, scope: unknown): void {
  if (typeof name === "string") assert_library_identifier(name, scope);
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
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new HostedAggregateRepresentationError(`${label} requires exact own data fields.`, operationIndex);
    }
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

/** Existing portable graph codec shared by private scoped effects. This does not
 * enable scoped state in hosted commits. @internal */
export function encode_scoped_effect_graph_operation(operation: DocumentGraphOp): string {
  if (operation.op === "ensure-quid") throw incompatible_graph();
  return encode_hosted_graph_operation(operation, true);
}
/** @internal */
export function decode_scoped_effect_graph_operation(payload: string): DocumentGraphOp {
  const operation = decode_hosted_graph_operation(payload, "document", true);
  if (operation.op === "ensure-quid") throw incompatible_graph();
  return operation;
}
