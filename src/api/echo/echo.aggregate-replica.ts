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
  LocusSocketLike,
} from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import type { HostedClientLibrariesSnapshot } from "../../types/livemap.types.js";
import { make_livemap_client_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import {
  assert_libraries_snapshot_bound,
  assert_hosted_client_snapshot_shape,
  complete_hosted_registry_as_projected_digest_internal,
} from "../livemap/livemap.hosted.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
  decode_locus_hosted_aggregate_envelope,
  type LocusHostedAggregateWireEnvelope,
} from "../locus/locus.hosted-multi-library.js";
import { decode_locus_live_projected_envelope_internal, type LocusLiveProjectedWireEnvelope } from "../locus/locus.live-projection.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.hosted-multi-library.protocol.js";
import {
  create_echo_endpoint_connection_internal,
  type EchoEndpointConnection,
} from "./echo.client.js";
import type {
  LocusHostedAggregateSynchronizationRequest,
} from "../locus/locus.hosted-multi-library.transport.internal.js";
import {
  create_echo_aggregate_replica_capability_internal,
  type EchoAggregateReplicaCapability,
} from "./echo.aggregate-replica.lifecycle.js";
import {
  configure_echo_hosted_aggregate_websocket_internal,
  type EchoHostedAggregateSynchronizationOutput,
} from "./echo.aggregate-websocket.internal.js";


type HostedPlanOutcome = "current" | "replay" | "snapshot" | "reject";
type AggregateSynchronizationOutput = EchoHostedAggregateSynchronizationOutput;

/** @internal */
export type MultiLibraryEchoSocketClientOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  socket: LocusSocketLike;
  /** Required for an unbootstrapped Echo; an existing mirror supplies it. */
  logicalMapId?: string;
  /** An existing aggregate mirror is restored in place during snapshot recovery. */
  map?: LiveMapLibraries;
  /** Client-owned definitions composed with the received authority snapshot. @internal */
  localLibraries?: import("../../types/livemap.types.js").LiveMapLibrariesInput;
  clientId?: string;
  actionId?: () => string;
  actionAttemptId?: () => string;
  actionStatusId?: () => string;
  session?: EchoSessionOptions;
  /** @internal Common public Echo shell supplied by deferred replica composition. */
  connection?: EchoEndpointConnection<TActions, LocusHostedAggregateSynchronizationRequest, AggregateSynchronizationOutput>;
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
  observeAuthorityPosition: (listener: (revision: number) => void) => LocusDisposer;
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
  if (options.connection !== undefined) {
    return create_multi_library_echo_semantic_client_internal(Object.freeze({ ...options, connection: options.connection }), false);
  }
  const connection = create_echo_endpoint_connection_internal<TActions>({
    socket: options.socket,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ids: {
      ...(options.actionId === undefined ? {} : { actionId: options.actionId }),
      ...(options.actionAttemptId === undefined ? {} : { actionAttemptId: options.actionAttemptId }),
      ...(options.actionStatusId === undefined ? {} : { actionStatusId: options.actionStatusId }),
    },
    endpointMessageFormat: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    actionMessageId: "attempt",
    operationLossError: (reason) => new Error(reason === "ended"
      ? "Hosted aggregate Echo session ended before the pending operation completed."
      : reason === "fenced"
        ? "Hosted aggregate session attachment was fenced."
        : "Hosted aggregate socket closed."),
  }) as EchoEndpointConnection<TActions, LocusHostedAggregateSynchronizationRequest, AggregateSynchronizationOutput>;
  configure_echo_hosted_aggregate_websocket_internal(connection);
  return create_multi_library_echo_semantic_client_internal(Object.freeze({ ...options, connection }), true);
}

function create_multi_library_echo_semantic_client_internal<
  TActions extends LocusActionPayloads,
>(
  options: MultiLibraryEchoSocketClientOptions<TActions> & Readonly<{
    connection: EchoEndpointConnection<TActions, LocusHostedAggregateSynchronizationRequest, AggregateSynchronizationOutput>;
  }>,
  ownsConnection: boolean,
): MultiLibraryEchoSocketClient {
  let map = options.map;
  const replica = create_echo_aggregate_replica_capability_internal(map, options.management);
  let logicalMapId = options.logicalMapId;
  let incarnationId: string | undefined;
  let registryDigest: string | undefined;
  let authorityRev: number | undefined;
  const authorityPositionListeners = new Set<(revision: number) => void>();
  const publishAuthorityPosition = (): void => {
    if (authorityRev === undefined) return;
    for (const listener of [...authorityPositionListeners]) listener(authorityRev);
  };
  if (map !== undefined) {
    const projection = replica.clientProjection();
    const snapshot = projection === undefined ? replica.captureHosted() : undefined;
    logicalMapId ??= projection?.authority.logicalMapId ?? snapshot?.authority.logicalMapId;
    incarnationId = projection?.authority.incarnationId ?? snapshot?.authority.incarnationId;
    registryDigest = projection?.registry.digest ?? snapshot?.registryDigest;
    authorityRev = projection?.revision ?? snapshot?.revision;
  }
  if (logicalMapId === undefined || logicalMapId.length === 0) {
    replica.dispose();
    throw new Error("Hosted aggregate socket Echo requires logicalMapId before bootstrap.");
  }
  const clientLogicalMapId = logicalMapId;
  let status: "idle" | "recovering" | "live" | "failed" | "closed" = "idle";
  let connected = false;
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

  const endpoint = options.connection.endpoint;
  const clientId = endpoint.clientId;

  compositionDisposers.push(options.connection.synchronization.onOutput((output) => {
    try {
      receiveReplica(output);
    } catch (cause) {
      failReplica(cause instanceof Error ? cause : new Error("Hosted aggregate replica failed."));
    }
  }));
  compositionDisposers.push(options.connection.onAttachmentLost((reason, error) => {
    if (reason !== "disconnect") interruptRecovery(error);
  }));
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

  function next(prefix: string): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
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
    options.connection.echo.disconnect();
  }

  function attachTransport(): LocusDisposer {
    return options.connection.echo.connect();
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
      const projection = replica.clientProjection();
      if (projection !== undefined) {
        incarnationId = projection.authority.incarnationId;
        registryDigest = projection.registry.digest;
      } else {
        const snapshot = replica.captureHosted();
        incarnationId = snapshot.authority.incarnationId;
        registryDigest = snapshot.registryDigest;
      }
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
      const request: LocusHostedAggregateSynchronizationRequest = Object.freeze({
        type: "recover",
        id,
        logicalMapId: clientLogicalMapId,
        ...(incarnationId === undefined || registryDigest === undefined || authorityRev === undefined
          ? {}
          : { cursor: Object.freeze({ incarnationId, registryDigest, lastAppliedRev: authorityRev }) }),
      });
      options.connection.synchronization.begin(request);
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

  function receiveReplica(message: AggregateSynchronizationOutput): void {
    if (message.type === "synchronization-failure") {
      const error = new Error(message.error.message);
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
    if (message.type === "recovery-progress") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "snapshot") throw new Error("Hosted recovery received unexpected authority progress.");
      apply_progress(message.progress, false);
      return;
    }
    if (message.type === "commit") {
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      // The old complete-authority recovery tail remains a separate, known
      // migration path until the next Step 6 phase.
      if (message.commit.format === LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT) apply_envelope(message.commit);
      else apply_live_envelope(message.commit);
      return;
    }
    if (message.type === "progress") {
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      apply_progress(message.progress, true);
      return;
    }
    if (message.type === "recovery-caught-up") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId || message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery caught-up fence is incompatible with this mirror.");
      }
      if (authorityRev !== message.throughRev) {
        throw new Error("Hosted recovery caught-up authority revision does not match the Echo cursor.");
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

  function install_snapshot(snapshot: HostedClientLibrariesSnapshot): void {
    assert_hosted_client_snapshot_shape(snapshot);
    if (snapshot.authority.logicalMapId !== clientLogicalMapId) throw new Error("Hosted aggregate snapshot logical map fence is incompatible.");
    if (recovery?.outcome === "snapshot" && map !== undefined && registryDigest !== undefined && snapshot.registryDigest !== registryDigest) {
      throw new Error("Hosted aggregate snapshot changes an existing registry topology.");
    }
    if (map === undefined) {
      // Construction occurs only after complete snapshot validation.
      map = make_livemap_client_mirror_from_snapshot_internal(snapshot, options.localLibraries);
      replica.attachMap(map);
    } else {
      // Aggregate recovery validates all roots, Schemas and map-wide QUID state before this
      // single in-place install; retained library handles keep their closure.
      replica.restoreHosted(snapshot);
    }
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = snapshot.registryDigest;
    authorityRev = snapshot.revision;
    publishAuthorityPosition();
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
    if (authorityRev === undefined || commit.prevRev !== authorityRev) {
      throw new Error("Hosted aggregate commit is not contiguous with the Echo authority cursor.");
    }
    replica.replayHosted(commit, replica.clientProjection() === undefined ? undefined : authorityRev);
    authorityRev = commit.rev;
    publishAuthorityPosition();
  }

  function apply_live_envelope(envelope: LocusHostedAggregateWireEnvelope | LocusLiveProjectedWireEnvelope): void {
    if (map === undefined || incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Projected live commit requires a hosted map.");
    }
    const liveDigest = replica.clientProjection()?.registry.digest
      ?? complete_hosted_registry_as_projected_digest_internal(replica.captureHosted().registry);
    const admitted = decode_locus_live_projected_envelope_internal(envelope, Object.freeze({
      logicalMapId: clientLogicalMapId, incarnationId, registryDigest: liveDigest,
    }));
    if (authorityRev === undefined || admitted.prevRev !== authorityRev) {
      throw new Error("Projected live commit is not contiguous with the Echo authority cursor.");
    }
    const commit = Object.freeze({ ...admitted, registryDigest });
    replica.replayHosted(commit, authorityRev);
    authorityRev = commit.rev;
    publishAuthorityPosition();
  }

  function apply_progress(progress: import("../locus/locus.hosted-multi-library.transport.internal.js").LocusHostedAggregateProgress, live: boolean): void {
    if (map === undefined || incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Hosted authority progress arrived before aggregate bootstrap.");
    }
    const expectedDigest = live && replica.clientProjection() === undefined
      ? complete_hosted_registry_as_projected_digest_internal(replica.captureHosted().registry)
      : registryDigest;
    if (progress.logicalMapId !== clientLogicalMapId || progress.incarnationId !== incarnationId
      || progress.registryDigest !== expectedDigest) throw new Error("Hosted authority progress fence is incompatible.");
    if (authorityRev === undefined || progress.prevRev !== authorityRev
      || !Number.isSafeInteger(progress.prevRev) || progress.prevRev < 0
      || progress.rev !== progress.prevRev + 1) {
      throw new Error("Hosted progress is not contiguous with the Echo authority cursor.");
    }
    if (!live || replica.clientProjection() !== undefined) replica.advanceHostedProgress(progress);
    authorityRev = progress.rev;
    publishAuthorityPosition();
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
    get lastAppliedRev() { return authorityRev; },
    observeAuthorityPosition(listener) {
      authorityPositionListeners.add(listener);
      return () => authorityPositionListeners.delete(listener);
    },
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
      if (ownsConnection) disconnect();
      const error = new Error("Hosted aggregate socket Echo is closed.");
      interruptRecovery(error);
      if (ownsConnection) options.connection.echo.dispose();
      while (compositionDisposers.length > 0) compositionDisposers.pop()?.();
      for (const waiter of readyWaiters) waiter.reject(error);
      readyWaiters.clear();
      replica.dispose();
      authorityPositionListeners.clear();
    },
    diagnostics: () => Object.freeze({
      status,
      pendingLive: 0,
    }),
  });
}
