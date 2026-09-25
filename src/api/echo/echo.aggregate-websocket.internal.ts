import type { LocusActionPayloads, LocusClientMessage } from "../../types/locus.types.js";
import { encode_locus_client_message } from "../locus/locus.protocol.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
} from "../locus/locus.aggregate.js";
import type { LocusLiveProjectedWireEnvelope } from "../locus/locus.live-projection.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.aggregate.protocol.js";
import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateProgress,
  LocusHostedProjectionChange,
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateSynchronizationRequest,
} from "../locus/locus.aggregate.transport.internal.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import { HOSTED_MAX_SNAPSHOT_BYTES, hosted_sha256 } from "../livemap/livemap.hosted.js";
import { HsonSchema } from "../schema/hson-schema.js";
import type { LiveMapLibraryAddOperation, LiveMapRootMode } from "../../types/livemap.types.js";
import type { LocusProjectedLibraryContract } from "../locus/locus.projection.js";
import type { LocusProjectionSystemFeature } from "../../types/locus.projection.types.js";
import type { EchoEndpointConnection } from "./echo.client.js";

export type EchoHostedAggregateSynchronizationOutput =
  | LocusHostedAggregateSynchronizationOutput
  | LocusHostedAggregateCanonicalPublication;

/** @internal Install aggregate framing only when the connection is the WebSocket adapter. */
export function configure_echo_hosted_aggregate_websocket_internal<TActions extends LocusActionPayloads>(
  connection: EchoEndpointConnection<TActions, LocusHostedAggregateSynchronizationRequest, EchoHostedAggregateSynchronizationOutput>,
): void {
  connection.setSynchronizationDecoder?.(decode_echo_hosted_aggregate_synchronization_frame_internal);
  connection.setMessageEncoder?.((message) => encode_echo_hosted_aggregate_request_frame_internal(message));
}

/** @internal Aggregate WebSocket request framing; semantic recovery keeps its cursor grouped. */
export function encode_echo_hosted_aggregate_request_frame_internal(message: LocusClientMessage | LocusHostedAggregateSynchronizationRequest): string {
  const raw = message.type === "recover" && "cursor" in message
    ? JSON.stringify({
        type: message.type,
        id: message.id,
        logicalMapId: message.logicalMapId,
        ...(message.cursor === undefined ? {} : message.cursor),
      })
    : encode_locus_client_message(message as LocusClientMessage);
  if (utf8_bytes(raw) > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
    throw new Error("Hosted aggregate Echo message exceeds the live wire byte limit.");
  }
  return raw;
}

/** @internal Aggregate WebSocket framing admission into typed synchronization output. */
export function decode_echo_hosted_aggregate_synchronization_frame_internal(raw: string): EchoHostedAggregateSynchronizationOutput | undefined {
  if (typeof raw !== "string" || utf8_bytes(raw) > HOSTED_MAX_SNAPSHOT_BYTES) throw new Error("Hosted aggregate server message exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate server message");
  if (value.format !== LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT) throw new Error("Hosted aggregate server protocol format is incompatible.");
  if (value.type === "ack" || value.type === "action-status" || value.type === "session-created"
    || value.type === "session-attached" || value.type === "session-rejected" || value.type === "session-fenced"
    || value.type === "session-ended" || (value.type === "error" && Object.hasOwn(value, "error"))) return undefined;
  if (value.type === "error") {
    const message = required_string(value.message);
    if (message === undefined) throw new Error("Hosted aggregate error is malformed.");
    return Object.freeze({
      type: "synchronization-failure",
      error: Object.freeze({
        ...(typeof value.code === "string" ? { code: value.code } : {}),
        message,
      }),
    });
  }
  const id = required_string(value.id);
  if (id === undefined) throw new Error("Hosted aggregate synchronization output requires an id.");
  if (value.type === "recovery-plan") {
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const projectionDigest = required_digest(value.projectionDigest);
    const headRev = required_revision(value.headRev);
    const projectionSequence = value.projectionSequence === undefined ? undefined : required_revision(value.projectionSequence);
    if (value.projectionSequence !== undefined && projectionSequence === undefined) throw new Error("Hosted recovery projection sequence is malformed.");
    if (logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || projectionDigest === undefined || headRev === undefined) throw new Error("Hosted recovery plan is malformed.");
    if (value.outcome === "reject") {
      const error = exact_record(value.error, "Hosted recovery rejection");
      const message = required_string(error.message);
      if (message === undefined) throw new Error("Hosted recovery rejection is malformed.");
      return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, projectionDigest,
        ...(projectionSequence === undefined ? {} : { projectionSequence }), headRev, outcome: "reject",
        error: Object.freeze({ ...(typeof error.code === "string" ? { code: error.code } : {}), message }) });
    }
    if (value.outcome !== "current" && value.outcome !== "replay" && value.outcome !== "snapshot") throw new Error("Hosted recovery plan outcome is invalid.");
    const outcome: "current" | "replay" | "snapshot" = value.outcome;
    return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, projectionDigest,
      ...(projectionSequence === undefined ? {} : { projectionSequence }), headRev, outcome,
      ...(typeof value.reason === "string" ? { reason: value.reason as "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable" } : {}) });
  }
  if (value.type === "recovery-snapshot") return Object.freeze({ type: "recovery-snapshot", id, snapshot: value.snapshot as AuthorityProjectionSnapshot });
  if (value.type === "recovery-commit") {
    if (value.phase !== "body" && value.phase !== "tail") throw new Error("Hosted recovery commit phase is malformed.");
    return Object.freeze({ type: "recovery-commit", id, phase: value.phase, commit: value.commit as LocusLiveProjectedWireEnvelope });
  }
  if (value.type === "recovery-progress") {
    if (value.phase !== "body" && value.phase !== "tail") throw new Error("Hosted recovery progress phase is malformed.");
    return Object.freeze({ type: "recovery-progress", id, phase: value.phase, progress: decode_progress(value.progress) });
  }
  if (value.type === "commit") return Object.freeze({ type: "commit", id, commit: value.commit as LocusLiveProjectedWireEnvelope });
  if (value.type === "progress") return Object.freeze({ type: "progress", id, progress: decode_progress(value.progress) });
  if (value.type === "projection-change") return decode_projection_change(value, id);
  if (value.type === "recovery-caught-up") {
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const projectionDigest = required_digest(value.projectionDigest);
    const throughRev = required_revision(value.throughRev);
    const projectionSequence = value.projectionSequence === undefined ? undefined : required_revision(value.projectionSequence);
    if (value.projectionSequence !== undefined && projectionSequence === undefined) throw new Error("Hosted recovery projection sequence is malformed.");
    if (logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || projectionDigest === undefined || throughRev === undefined) throw new Error("Hosted recovery caught-up is malformed.");
    return Object.freeze({ type: "recovery-caught-up", id, logicalMapId, incarnationId, registryDigest, projectionDigest,
      ...(projectionSequence === undefined ? {} : { projectionSequence }), throughRev });
  }
  throw new Error("Hosted aggregate server message type is unknown.");
}

function decode_projection_change(value: Record<string, unknown>, id: string): LocusHostedProjectionChange {
  const fields = ["format", "type", "id", "logicalMapId", "incarnationId", "authorityRev", "sequence",
    "previousDigest", "projectionDigest", "registryDigest", "libraries", "htmlDocument", "systemFeatures", "writableDocuments"];
  const actual = Object.keys(value);
  if (actual.length < fields.length || actual.length > fields.length + 2
    || fields.some((field) => !Object.hasOwn(value, field))
    || actual.some((field) => !fields.includes(field) && field !== "topology" && field !== "system")) {
    throw new Error("Hosted projection change fields are malformed.");
  }
  const logicalMapId = required_string(value.logicalMapId);
  const incarnationId = required_string(value.incarnationId);
  const authorityRev = required_revision(value.authorityRev);
  const sequence = required_revision(value.sequence);
  const previousDigest = required_digest(value.previousDigest);
  const projectionDigest = required_digest(value.projectionDigest);
  const registryDigest = required_digest(value.registryDigest);
  if (logicalMapId === undefined || incarnationId === undefined || authorityRev === undefined
    || sequence === undefined || previousDigest === undefined || projectionDigest === undefined
    || registryDigest === undefined || !Array.isArray(value.libraries)
    || !Array.isArray(value.systemFeatures) || !Array.isArray(value.writableDocuments)) {
    throw new Error("Hosted projection change is malformed.");
  }
  const libraries: LocusProjectedLibraryContract[] = value.libraries.map((raw: unknown) => {
    const entry = exact_record(raw, "Hosted projection Library contract");
    if (!has_fields(entry, ["name", "mode", "schema", "schemaDigest", "rootCodec"])) {
      throw new Error("Hosted projection Library contract fields are malformed.");
    }
    const name = required_string(entry.name);
    const schema = required_string(entry.schema);
    const schemaDigest = required_digest(entry.schemaDigest);
    if (name === undefined || !is_root_mode(entry.mode) || schema === undefined || schemaDigest === undefined
      || entry.rootCodec !== "hson-exact-value" || hosted_sha256(schema) !== schemaDigest) {
      throw new Error("Hosted projection Library contract is malformed.");
    }
    const canonicalSchema = HsonSchema.fromHson(schema).toHson();
    if (canonicalSchema !== schema) throw new Error("Hosted projection Schema is noncanonical.");
    return Object.freeze({ name, mode: entry.mode, schema: canonicalSchema, schemaDigest, rootCodec: "hson-exact-value" });
  });
  if (libraries.some((entry, index) => index > 0 && libraries[index - 1]!.name.localeCompare(entry.name) >= 0)) {
    throw new Error("Hosted projection Library order is malformed.");
  }
  const htmlDocument = value.htmlDocument;
  if (htmlDocument !== null && (typeof htmlDocument !== "string"
    || !libraries.some((entry) => entry.name === htmlDocument && entry.mode === "document"))) {
    throw new Error("Hosted projection HTML selection is malformed.");
  }
  const systemFeatures: LocusProjectionSystemFeature[] = [];
  for (const feature of value.systemFeatures) {
    if (feature !== "interactions" || systemFeatures.length !== 0) throw new Error("Hosted projection feature is malformed.");
    systemFeatures.push(feature);
  }
  const writableDocuments: string[] = [];
  for (const name of value.writableDocuments) {
    if (typeof name !== "string" || !libraries.some((entry) => entry.name === name && entry.mode === "document")
      || (writableDocuments.length > 0 && writableDocuments[writableDocuments.length - 1]!.localeCompare(name) >= 0)) {
      throw new Error("Hosted projection writable document is malformed.");
    }
    writableDocuments.push(name);
  }
  let topology: LiveMapLibraryAddOperation | undefined;
  if (Object.hasOwn(value, "topology")) {
    const raw = exact_record(value.topology, "Hosted projection topology");
    const operation = exact_record(raw.operation, "Hosted projection topology operation");
    if (!has_fields(raw, ["library", "operation"]) || !has_fields(operation, ["kind", "libraries"])
      || operation.kind !== "library-add" || !Array.isArray(operation.libraries)) {
      throw new Error("Hosted projection topology is malformed.");
    }
    const additions = operation.libraries.map((candidate: unknown) => {
      const entry = exact_record(candidate, "Hosted projection topology Library");
      const root = exact_record(entry.root, "Hosted projection topology root");
      if (!has_fields(entry, ["name", "mode", "schema", "root"]) || !has_fields(root, ["format", "payload"])
        || typeof entry.name !== "string" || !is_root_mode(entry.mode) || typeof entry.schema !== "string"
        || root.format !== "hson-exact-value" || typeof root.payload !== "string") {
        throw new Error("Hosted projection topology Library is malformed.");
      }
      const schema = HsonSchema.fromHson(entry.schema).toHson();
      if (schema !== entry.schema) throw new Error("Hosted projection topology Schema is noncanonical.");
      const format: "hson-exact-value" = "hson-exact-value";
      return Object.freeze({ name: entry.name, mode: entry.mode, schema,
        root: Object.freeze({ format, payload: root.payload }) });
    });
    if (additions.length === 0 || raw.library !== additions[0]?.name) {
      throw new Error("Hosted projection topology batch is malformed.");
    }
    topology = Object.freeze({ library: additions[0].name,
      operation: Object.freeze({ kind: "library-add", libraries: Object.freeze(additions) }) });
  }
  let system: Readonly<{ format: "hson-exact-value"; payload: string }> | undefined;
  if (Object.hasOwn(value, "system")) {
    const root = exact_record(value.system, "Hosted projection system root");
    if (!has_fields(root, ["format", "payload"]) || root.format !== "hson-exact-value"
      || typeof root.payload !== "string") throw new Error("Hosted projection system root is malformed.");
    system = Object.freeze({ format: "hson-exact-value", payload: root.payload });
  }
  return Object.freeze({ type: "projection-change", id, logicalMapId, incarnationId, authorityRev,
    sequence, previousDigest, projectionDigest, registryDigest,
    libraries: Object.freeze(libraries), htmlDocument, systemFeatures: Object.freeze(systemFeatures),
    writableDocuments: Object.freeze(writableDocuments),
    ...(topology === undefined ? {} : { topology }), ...(system === undefined ? {} : { system }),
  });
}

function has_fields(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

function is_root_mode(value: unknown): value is LiveMapRootMode {
  return value === "data-object" || value === "data-array" || value === "data-string" || value === "data-number"
    || value === "data-boolean" || value === "data-null" || value === "document";
}

function utf8_bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function exact_record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}
function required_string(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function required_digest(value: unknown): string | undefined { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined; }
function required_revision(value: unknown): number | undefined { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function decode_progress(input: unknown): LocusHostedAggregateProgress {
  const progress = exact_record(input, "Hosted authority progress");
  const fields = ["logicalMapId", "incarnationId", "registryDigest", "prevRev", "rev"];
  if (Object.keys(progress).length !== fields.length || fields.some((field) => !Object.hasOwn(progress, field))) {
    throw new Error("Hosted authority progress fields are malformed.");
  }
  const logicalMapId = required_string(progress.logicalMapId);
  const incarnationId = required_string(progress.incarnationId);
  const registryDigest = required_digest(progress.registryDigest);
  const prevRev = required_revision(progress.prevRev);
  const rev = required_revision(progress.rev);
  if (logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined
    || prevRev === undefined || rev !== prevRev + 1) throw new Error("Hosted authority progress is malformed.");
  return Object.freeze({ logicalMapId, incarnationId, registryDigest, prevRev, rev });
}
