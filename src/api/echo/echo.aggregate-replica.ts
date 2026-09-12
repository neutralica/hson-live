import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type {
  LocusActionTerminalOutcome,
  LocusClientActionResult,
  LocusDisposer,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoSession,
  EchoSessionOptions,
  LocusActionPayloads,
  LocusClientMessage,
  LocusSocketLike,
} from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { decode_locus_server_message, encode_locus_client_message } from "../locus/locus.protocol.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import {
  HOSTED_MAX_SNAPSHOT_BYTES,
  assert_hosted_snapshot_bound,
  assert_hosted_snapshot_shape,
  type HostedAggregateSnapshot,
} from "../livemap/livemap.hosted.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  decode_locus_hosted_aggregate_envelope,
  type LocusHostedAggregateWireEnvelope,
} from "../locus/locus.hosted-multi-library.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.hosted-multi-library.protocol.js";
import { create_echo_endpoint_internal, type EchoEndpointServerMessage } from "./echo.endpoint.js";
import type { EchoEndpointConnection } from "./echo.client.js";
import { make_echo_reload_safe_id } from "./echo.request.js";
import {
  create_echo_aggregate_replica_capability_internal,
  type EchoAggregateReplicaCapability,
} from "./echo.aggregate-replica.lifecycle.js";


type HostedPlanOutcome = "current" | "replay" | "snapshot" | "reject";
type HostedSnapshotReason = "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable";

/** @internal */
export type MultiLibraryEchoSocketClientOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  socket: LocusSocketLike;
  /** Required for an unbootstrapped Echo; an existing mirror supplies it. */
  logicalMapId?: string;
  /** An existing aggregate mirror is restored in place during snapshot recovery. */
  map?: LiveMapLibraries;
  clientId?: string;
  actionId?: () => string;
  actionAttemptId?: () => string;
  actionStatusId?: () => string;
  session?: EchoSessionOptions;
  /** @internal Common public Echo shell supplied by deferred replica composition. */
  connection?: EchoEndpointConnection<TActions>;
  /** @internal Management acquired synchronously by the public Echo shell. */
  management?: EchoMapManagementLease;
}>;

/** @internal */
export type MultiLibraryEchoSocketRecovery = Readonly<{
  outcome: Exclude<HostedPlanOutcome, "reject">;
  revision: number;
}>;

/** @internal */
export type MultiLibraryEchoSocketClient = Readonly<{
  /** Undefined until an aggregate bootstrap snapshot has passed every validation check. */
  readonly map: LiveMapLibraries | undefined;
  readonly logicalMapId: string;
  readonly incarnationId: string | undefined;
  readonly registryDigest: string | undefined;
  readonly lastAppliedRev: number | undefined;
  /** @internal Exact aggregate replica owner used by full-Echo composition. */
  readonly replica: EchoAggregateReplicaCapability;
  readonly clientId: string;
  readonly session: EchoSession;
  /** @internal Legacy orchestration retained for aggregate mechanism proofs. */
  connect: () => Promise<MultiLibraryEchoSocketRecovery>;
  attachTransport: () => LocusDisposer;
  disconnect: () => void;
  recover: () => Promise<MultiLibraryEchoSocketRecovery>;
  action: (name: string, payload?: JsonValue) => Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }>;
  retryAction: (request: EchoActionRequest) => Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }>;
  actionStatus: (requestId: string) => Promise<EchoActionStatusResult>;
  wait_until_ready: () => Promise<void>;
  dispose: () => void;
  diagnostics: () => Readonly<{
    status: "idle" | "recovering" | "live" | "failed" | "closed";
    pendingLive: number;
  }>;
}>;

/** @internal Aggregate replica/recovery capability composed with the common endpoint. */
export function create_multi_library_echo_socket_client_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: MultiLibraryEchoSocketClientOptions<TActions>): MultiLibraryEchoSocketClient {
  let generatedId = 0;
  const fresh_id = (prefix: string): string => {
    generatedId += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
  };
  let map = options.map;
  const replica = create_echo_aggregate_replica_capability_internal(map, options.management);
  let logicalMapId = options.logicalMapId;
  let incarnationId: string | undefined;
  let registryDigest: string | undefined;
  let lastAppliedRev: number | undefined;
  if (map !== undefined) {
    const snapshot = replica.captureHosted();
    logicalMapId ??= snapshot.authority.logicalMapId;
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = snapshot.registryDigest;
    lastAppliedRev = snapshot.revision;
  }
  if (logicalMapId === undefined || logicalMapId.length === 0) {
    replica.dispose();
    throw new Error("Hosted aggregate socket Echo requires logicalMapId before bootstrap.");
  }
  const clientLogicalMapId = logicalMapId;
  let status: "idle" | "recovering" | "live" | "failed" | "closed" = "idle";
  let connected = false;
  let stopMessage: LocusDisposer | undefined;
  let stopClose: LocusDisposer | undefined;
  const compositionDisposers: LocusDisposer[] = [];
  let nextId = 0;
  let recovery: Readonly<{
    id: string;
    sessionId: string;
    sessionEpoch: number;
    resolve: (value: MultiLibraryEchoSocketRecovery) => void;
    reject: (reason: Error) => void;
    outcome?: Exclude<HostedPlanOutcome, "reject">;
    snapshotReceived: boolean;
  }> | undefined;
  let liveRecovery: Readonly<{ id: string; sessionId: string; sessionEpoch: number }> | undefined;
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();

  const endpoint = options.connection?.endpoint ?? create_echo_endpoint_internal({
    transport: { send },
    clientId: options.clientId ?? make_echo_reload_safe_id("echo-client"),
    sessionRequired: true,
    ...(options.session?.credential === undefined ? {} : { credential: options.session.credential }),
    ids: {
      actionId: options.actionId ?? (() => make_echo_reload_safe_id("action")),
      actionAttemptId: options.actionAttemptId ?? (() => fresh_id("attempt")),
      actionStatusId: options.actionStatusId ?? (() => fresh_id("action-status")),
      sessionRequestId: (kind) => next(`session-${kind === "reattach" ? "attach" : kind}`),
    },
    actionMessageId: "attempt",
    operationLossError: (reason) => new Error(reason === "ended"
      ? "Hosted aggregate Echo session ended before the pending operation completed."
      : reason === "fenced"
        ? "Hosted aggregate session attachment was fenced."
        : "Hosted aggregate socket closed."),
    onAttachmentLost: (_reason, error) => interruptRecovery(error),
  });
  const clientId = endpoint.clientId;

  const receiveRaw = (raw: string): void => {
    let message: DecodedServerMessage;
    try {
      message = decode_server_message(raw);
    } catch (cause) {
      failEndpoint(cause instanceof Error ? cause : new Error("Hosted aggregate Echo protocol failed."));
      return;
    }
    if (is_endpoint_server_message(message)) {
      if (options.connection === undefined) endpoint.receive(message);
      return;
    }
    try {
      receiveReplica(message);
    } catch (cause) {
      failReplica(cause instanceof Error ? cause : new Error("Hosted aggregate replica failed."));
    }
  };

  if (options.connection !== undefined) {
    compositionDisposers.push(options.connection.onRawMessage(receiveRaw));
    compositionDisposers.push(options.connection.onConnectionChange((nextConnected) => {
      if (nextConnected) {
        connected = true;
        return;
      }
      if (!connected) return;
      connected = false;
      const error = new Error("Hosted aggregate socket Echo disconnected.");
      interruptRecovery(error);
      replica.markFailed(error);
      if (status !== "closed") status = "idle";
    }));
    compositionDisposers.push(options.connection.setMessageEncoder((message) => {
      const raw = encode_locus_client_message(message);
      if (utf8_bytes(raw) > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
        throw new Error("Hosted aggregate Echo message exceeds the live wire byte limit.");
      }
      return raw;
    }));
  }

  function next(prefix: string): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
  }

  function send(message: unknown): void {
    if (status === "closed") throw new Error("Hosted aggregate socket Echo is closed.");
    const raw = is_exact_endpoint_client_message(message)
      ? encode_locus_client_message(message)
      : JSON.stringify(message);
    if (utf8_bytes(raw) > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
      throw new Error("Hosted aggregate Echo message exceeds the live wire byte limit.");
    }
    options.socket.send(raw);
  }

  function interruptRecovery(error: Error): void {
    const active = recovery;
    recovery = undefined;
    liveRecovery = undefined;
    if (status === "recovering" || status === "live") status = "idle";
    active?.reject(error);
  }

  function recoveryCurrent(active: NonNullable<typeof recovery>): boolean {
    return recovery === active
      && endpoint.session.status === "attached"
      && endpoint.session.sessionId === active.sessionId
      && endpoint.session.epoch === active.sessionEpoch;
  }

  function failReplica(error: Error): void {
    if (status === "closed" || status === "failed") return;
    status = "failed";
    replica.markFailed(error);
    interruptRecovery(error);
    for (const waiter of readyWaiters) waiter.reject(error);
    readyWaiters.clear();
  }

  function failEndpoint(error: Error): void {
    failReplica(error);
    endpoint.disconnect();
  }

  function disconnect(): void {
    if (options.connection !== undefined) {
      options.connection.echo.disconnect();
      return;
    }
    if (!connected) return;
    connected = false;
    stopMessage?.();
    stopMessage = undefined;
    stopClose?.();
    stopClose = undefined;
    const error = new Error("Hosted aggregate socket Echo disconnected.");
    interruptRecovery(error);
    replica.markFailed(error);
    endpoint.disconnect();
    if (status !== "closed") status = "idle";
  }

  function attachTransport(): LocusDisposer {
    if (options.connection !== undefined) return options.connection.echo.connect();
    if (status === "closed" || connected) return disconnect;
    connected = true;
    stopMessage = options.socket.onMessage(receiveRaw) ?? undefined;
    stopClose = options.socket.onClose(disconnect) ?? undefined;
    endpoint.connect();
    return disconnect;
  }

  function recover_wire(): Promise<MultiLibraryEchoSocketRecovery> {
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate socket Echo is closed."));
    if (!connected) return Promise.reject(new Error("Hosted aggregate recovery requires a connected transport."));
    if (recovery !== undefined) return Promise.reject(new Error("Hosted aggregate recovery is already in progress."));
    if (endpoint.session.status !== "attached" || endpoint.session.sessionId === undefined || endpoint.session.epoch === undefined) {
      return Promise.reject(new Error("Hosted aggregate recovery requires an attached session."));
    }
    if (endpoint.session.logicalMapId !== clientLogicalMapId) {
      return Promise.reject(new Error("Hosted aggregate session authority does not match the configured recovery target."));
    }
    if (map !== undefined) {
      const snapshot = replica.captureHosted();
      incarnationId = snapshot.authority.incarnationId;
      registryDigest = snapshot.registryDigest;
      lastAppliedRev = snapshot.revision;
    }
    status = "recovering";
    replica.markRecovering();
    const id = next("recover");
    const recoverySessionId = endpoint.session.sessionId;
    const recoverySessionEpoch = endpoint.session.epoch;
    return new Promise<MultiLibraryEchoSocketRecovery>((resolve, reject) => {
      recovery = Object.freeze({
        id,
        sessionId: recoverySessionId,
        sessionEpoch: recoverySessionEpoch,
        resolve,
        reject,
        snapshotReceived: false,
      });
      send(Object.freeze({
        type: "recover",
        id,
        logicalMapId: clientLogicalMapId,
        ...(incarnationId === undefined || registryDigest === undefined || lastAppliedRev === undefined
          ? {}
          : { incarnationId, registryDigest, lastAppliedRev }),
      }));
    });
  }

  async function connect_client(): Promise<MultiLibraryEchoSocketRecovery> {
    attachTransport();
    if (endpoint.session.status !== "attached") {
      if (endpoint.session.credential === undefined) await endpoint.session.create();
      else await endpoint.session.reattach(endpoint.session.credential);
    }
    return recover_wire();
  }

  function receiveReplica(message: Exclude<DecodedServerMessage, EchoEndpointServerMessage>): void {
    if (message.type === "error") {
      const error = new Error(message.message);
      failEndpoint(error);
      return;
    }
    if (message.type === "recovery-plan") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (message.logicalMapId !== clientLogicalMapId
        || message.logicalMapId !== endpoint.session.logicalMapId
        || message.incarnationId !== endpoint.session.incarnationId) {
        throw new Error("Hosted recovery plan authority fence is incompatible with the attached session.");
      }
      if (message.outcome === "reject") throw new Error(message.error.message);
      if (map !== undefined && registryDigest !== undefined && message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery registry mismatch requires a fresh aggregate bootstrap.");
      }
      if (recoveryCurrent(active)) recovery = Object.freeze({ ...active, outcome: message.outcome });
      return;
    }
    if (message.type === "recovery-snapshot") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "snapshot") throw new Error("Hosted recovery received an unexpected aggregate snapshot.");
      install_snapshot(message.snapshot);
      if (recoveryCurrent(active)) recovery = Object.freeze({ ...active, snapshotReceived: true });
      return;
    }
    if (message.type === "recovery-commit") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "snapshot") throw new Error("Hosted recovery received an unexpected aggregate commit.");
      apply_envelope(message.commit);
      return;
    }
    if (message.type === "commit") {
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      apply_envelope(message.commit);
      return;
    }
    if (message.type === "recovery-caught-up") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId || message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery caught-up fence is incompatible with this mirror.");
      }
      if (map === undefined || map.rev !== message.throughRev || lastAppliedRev !== message.throughRev) {
        throw new Error("Hosted recovery caught-up revision does not match the complete Echo replica.");
      }
      status = "live";
      replica.markReady();
      recovery = undefined;
      liveRecovery = Object.freeze({ id: active.id, sessionId: active.sessionId, sessionEpoch: active.sessionEpoch });
      active.resolve(Object.freeze({ outcome: active.outcome ?? "current", revision: message.throughRev }));
      if (endpoint.ready) {
        for (const waiter of [...readyWaiters]) waiter.resolve();
        readyWaiters.clear();
      }
      return;
    }
    throw new Error("Unknown hosted aggregate socket message.");
  }

  function current_recovery(id: string): NonNullable<typeof recovery> | undefined {
    const active = recovery;
    if (active === undefined || active.id !== id || !recoveryCurrent(active)) return undefined;
    return active;
  }

  function install_snapshot(snapshot: HostedAggregateSnapshot): void {
    assert_hosted_snapshot_shape(snapshot);
    assert_hosted_snapshot_bound(snapshot);
    if (snapshot.authority.logicalMapId !== clientLogicalMapId) throw new Error("Hosted aggregate snapshot logical map fence is incompatible.");
    if (recovery?.outcome === "snapshot" && map !== undefined && registryDigest !== undefined && snapshot.registryDigest !== registryDigest) {
      throw new Error("Hosted aggregate snapshot changes an existing registry topology.");
    }
    if (map === undefined) {
      // Construction occurs only after complete snapshot validation.
      map = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
      replica.attachMap(map);
    } else {
      // Aggregate recovery validates all roots, Schemas and map-wide QUID state before this
      // single in-place install; retained library handles keep their closure.
      replica.restoreHosted(snapshot);
    }
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = snapshot.registryDigest;
    lastAppliedRev = snapshot.revision;
  }

  function apply_envelope(envelope: LocusHostedAggregateWireEnvelope): void {
    if (map === undefined || incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Hosted aggregate commit arrived before aggregate bootstrap.");
    }
    const commit = decode_locus_hosted_aggregate_envelope(envelope, Object.freeze({
      logicalMapId: clientLogicalMapId,
      incarnationId,
      registryDigest,
      maxWireBytes: DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
    }));
    lastAppliedRev = replica.replayHosted(commit);
  }

  function wait_until_ready(): Promise<void> {
    if (status === "live" && endpoint.ready) return Promise.resolve();
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate socket Echo is closed."));
    return new Promise((resolve, reject) => { readyWaiters.add(Object.freeze({ resolve, reject })); });
  }

  const session = endpoint.session;
  const action = endpoint.action;
  const retryAction = endpoint.retryAction;
  const actionStatus = endpoint.actionStatus;

  return Object.freeze({
    get map() { return map; },
    logicalMapId: clientLogicalMapId,
    get incarnationId() { return incarnationId; },
    get registryDigest() { return registryDigest; },
    get lastAppliedRev() { return lastAppliedRev; },
    replica,
    clientId,
    session,
    connect: connect_client,
    attachTransport,
    disconnect,
    recover: recover_wire,
    action: action as MultiLibraryEchoSocketClient["action"],
    retryAction: retryAction as MultiLibraryEchoSocketClient["retryAction"],
    actionStatus,
    wait_until_ready,
    dispose: () => {
      if (status === "closed") return;
      status = "closed";
      if (options.connection === undefined) disconnect();
      const error = new Error("Hosted aggregate socket Echo is closed.");
      interruptRecovery(error);
      if (options.connection === undefined) endpoint.dispose();
      while (compositionDisposers.length > 0) compositionDisposers.pop()?.();
      for (const waiter of readyWaiters) waiter.reject(error);
      readyWaiters.clear();
      replica.dispose();
    },
    diagnostics: () => Object.freeze({
      status,
      pendingLive: 0,
    }),
  });
}

function is_exact_endpoint_client_message(message: unknown): message is LocusClientMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) return false;
  const type = Reflect.get(message, "type");
  return type === "action"
    || type === "action-status"
    || type === "session-create"
    || type === "session-attach"
    || type === "session-goodbye";
}

type DecodedServerMessage =
  | Readonly<{ type: "error"; id?: string; message: string }>
  | LocusClientActionResult
  | Readonly<{ type: "action-status"; id: string; requestId: string; state: "pending" | "succeeded" | "failed" | "unknown" | "expired"; outcome?: LocusActionTerminalOutcome }>
  | Readonly<{ type: "session-created"; id: string; sessionId: string; credential: string; epoch: number; logicalMapId: string; incarnationId: string }>
  | Readonly<{ type: "session-attached"; id: string; sessionId: string; epoch: number; logicalMapId: string; incarnationId: string }>
  | Readonly<{ type: "session-rejected"; id: string; code: string; message: string }>
  | Readonly<{ type: "session-fenced"; sessionId: string; epoch: number; code: "LOCUS_SESSION_ATTACHMENT_FENCED" }>
  | Readonly<{ type: "session-ended"; id: string; sessionId: string; epoch: number }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: Exclude<HostedPlanOutcome, "reject">; reason?: HostedSnapshotReason }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: "reject"; error: Readonly<{ message: string }> }>
  | Readonly<{ type: "recovery-snapshot"; id: string; snapshot: HostedAggregateSnapshot }>
  | Readonly<{ type: "recovery-commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "recovery-caught-up"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; throughRev: number }>;

function is_endpoint_server_message(message: DecodedServerMessage): message is EchoEndpointServerMessage {
  return message.type === "ack"
    || message.type === "action-status"
    || message.type === "session-created"
    || message.type === "session-attached"
    || message.type === "session-rejected"
    || message.type === "session-fenced"
    || message.type === "session-ended"
    || (message.type === "error" && "ok" in message);
}

function decode_server_message(raw: string): DecodedServerMessage {
  if (typeof raw !== "string" || utf8_bytes(raw) > HOSTED_MAX_SNAPSHOT_BYTES) throw new Error("Hosted aggregate server message exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate server message");
  if (value.format !== LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT) throw new Error("Hosted aggregate server protocol format is incompatible.");
  if (value.type === "ack"
    || value.type === "action-status"
    || value.type === "session-created"
    || value.type === "session-attached"
    || value.type === "session-rejected"
    || value.type === "session-fenced"
    || value.type === "session-ended"
    || (value.type === "error" && Object.hasOwn(value, "error"))) {
    const standard: Record<string, unknown> = { ...value };
    delete standard.format;
    const decoded = decode_locus_server_message(JSON.stringify(standard));
    if (!decoded.ok) throw new Error(decoded.error.message);
    const message = decoded.value;
    if (message.type === "ack"
      || message.type === "action-status"
      || message.type === "session-created"
      || message.type === "session-attached"
      || message.type === "session-rejected"
      || message.type === "session-fenced"
      || message.type === "session-ended"
      || message.type === "error") return message;
    throw new Error("Hosted aggregate shared Locus response type is malformed.");
  }
  if (value.type === "error") {
    const hasId = Object.hasOwn(value, "id");
    exact_keys(value, hasId ? ["type", "format", "id", "code", "message"] : ["type", "format", "code", "message"], "Hosted aggregate error");
    const message = required_string(value.message);
    if (message === undefined || typeof value.code !== "string" || (hasId && required_string(value.id) === undefined)) throw new Error("Hosted aggregate error is malformed.");
    return Object.freeze({ type: "error", ...(hasId ? { id: value.id as string } : {}), message });
  }
  if (value.type === "recovery-plan") {
    const outcome = value.outcome;
    const isSnapshot = outcome === "snapshot";
    const isReject = outcome === "reject";
    exact_keys(value, isSnapshot
      ? ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome", "reason"]
      : isReject
        ? ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome", "error"]
        : ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome"], "Hosted recovery plan");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const headRev = required_revision(value.headRev);
    if (id === undefined || logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || headRev === undefined) throw new Error("Hosted recovery plan is malformed.");
    if (isReject) {
      const error = exact_record(value.error, "Hosted recovery rejection");
      exact_keys(error, ["code", "message"], "Hosted recovery rejection");
      const message = required_string(error.message);
      if (typeof error.code !== "string" || message === undefined) throw new Error("Hosted recovery rejection is malformed.");
      return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome: "reject", error: Object.freeze({ message }) });
    }
    if (outcome !== "current" && outcome !== "replay" && outcome !== "snapshot") throw new Error("Hosted recovery plan outcome is invalid.");
    if (isSnapshot && !is_snapshot_reason(value.reason)) throw new Error("Hosted recovery snapshot reason is invalid.");
    const acceptedOutcome: Exclude<HostedPlanOutcome, "reject"> = outcome;
    return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome: acceptedOutcome, ...(isSnapshot ? { reason: value.reason as HostedSnapshotReason } : {}) });
  }
  if (value.type === "recovery-snapshot") {
    exact_keys(value, ["type", "format", "id", "snapshot"], "Hosted recovery snapshot");
    const id = required_string(value.id);
    if (id === undefined) throw new Error("Hosted recovery snapshot is malformed.");
    return Object.freeze({ type: "recovery-snapshot", id, snapshot: value.snapshot as HostedAggregateSnapshot });
  }
  if (value.type === "recovery-commit") {
    exact_keys(value, ["type", "format", "id", "phase", "commit"], "Hosted recovery commit");
    const id = required_string(value.id);
    if (id === undefined || (value.phase !== "body" && value.phase !== "tail")) throw new Error("Hosted recovery commit is malformed.");
    return Object.freeze({ type: "recovery-commit", id, commit: value.commit as LocusHostedAggregateWireEnvelope });
  }
  if (value.type === "commit") {
    exact_keys(value, ["type", "format", "id", "commit"], "Hosted live commit");
    const id = required_string(value.id);
    if (id === undefined) throw new Error("Hosted live commit is malformed.");
    return Object.freeze({ type: "commit", id, commit: value.commit as LocusHostedAggregateWireEnvelope });
  }
  if (value.type === "recovery-caught-up") {
    exact_keys(value, ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "throughRev"], "Hosted recovery caught-up");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const throughRev = required_revision(value.throughRev);
    if (id === undefined || logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || throughRev === undefined) throw new Error("Hosted recovery caught-up is malformed.");
    return Object.freeze({ type: "recovery-caught-up", id, logicalMapId, incarnationId, registryDigest, throughRev });
  }
  throw new Error("Hosted aggregate server message type is unknown.");
}

function bounded(value: number | undefined, fallback: number, label: string, ceiling: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > ceiling) throw new Error(`Hosted aggregate ${label} bound is invalid.`);
  return result;
}

function encoded_bytes(value: unknown): number {
  return utf8_bytes(JSON.stringify(value));
}

function utf8_bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exact_record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function exact_keys(value: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function required_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function required_digest(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function required_revision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}


function is_snapshot_reason(value: unknown): value is HostedSnapshotReason {
  return value === "no_usable_revision" || value === "incarnation_mismatch" || value === "registry_mismatch" || value === "history_unavailable";
}
