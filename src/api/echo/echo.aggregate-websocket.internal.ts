import type { LocusActionPayloads, LocusClientMessage } from "../../types/locus.types.js";
import { encode_locus_client_message } from "../locus/locus.protocol.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  type LocusHostedAggregateWireEnvelope,
} from "../locus/locus.hosted-multi-library.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.hosted-multi-library.protocol.js";
import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateProgress,
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateSynchronizationRequest,
} from "../locus/locus.hosted-multi-library.transport.internal.js";
import type { HostedLiveMapLibrariesSnapshot } from "../../types/livemap.types.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted.js";
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
    const headRev = required_revision(value.headRev);
    if (logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || headRev === undefined) throw new Error("Hosted recovery plan is malformed.");
    if (value.outcome === "reject") {
      const error = exact_record(value.error, "Hosted recovery rejection");
      const message = required_string(error.message);
      if (message === undefined) throw new Error("Hosted recovery rejection is malformed.");
      return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome: "reject", error: Object.freeze({ ...(typeof error.code === "string" ? { code: error.code } : {}), message }) });
    }
    if (value.outcome !== "current" && value.outcome !== "replay" && value.outcome !== "snapshot") throw new Error("Hosted recovery plan outcome is invalid.");
    const outcome: "current" | "replay" | "snapshot" = value.outcome;
    return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome, ...(typeof value.reason === "string" ? { reason: value.reason as "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable" } : {}) });
  }
  if (value.type === "recovery-snapshot") return Object.freeze({ type: "recovery-snapshot", id, snapshot: value.snapshot as HostedLiveMapLibrariesSnapshot });
  if (value.type === "recovery-commit") {
    if (value.phase !== "body" && value.phase !== "tail") throw new Error("Hosted recovery commit phase is malformed.");
    return Object.freeze({ type: "recovery-commit", id, phase: value.phase, commit: value.commit as LocusHostedAggregateWireEnvelope });
  }
  if (value.type === "recovery-progress") {
    if (value.phase !== "body" && value.phase !== "tail") throw new Error("Hosted recovery progress phase is malformed.");
    return Object.freeze({ type: "recovery-progress", id, phase: value.phase, progress: decode_progress(value.progress) });
  }
  if (value.type === "commit") return Object.freeze({ type: "commit", id, commit: value.commit as LocusHostedAggregateWireEnvelope });
  if (value.type === "progress") return Object.freeze({ type: "progress", id, progress: decode_progress(value.progress) });
  if (value.type === "recovery-caught-up") {
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const throughRev = required_revision(value.throughRev);
    if (logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || throughRev === undefined) throw new Error("Hosted recovery caught-up is malformed.");
    return Object.freeze({ type: "recovery-caught-up", id, logicalMapId, incarnationId, registryDigest, throughRev });
  }
  throw new Error("Hosted aggregate server message type is unknown.");
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
