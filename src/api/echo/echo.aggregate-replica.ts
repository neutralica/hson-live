import { hson_schema_source_digest } from "../schema/hson-schema.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap,
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
} from "../../types/locus.types.js";
import type { EchoReplicaTransport, EchoSynchronizationSubscription, EchoSynchronizationEnd } from "../../types/echo.transport.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import { make_livemap_libraries, make_livemap_client_composition_from_portable_aggregate_internal } from "../livemap/livemap.libraries.js";
import { admit_locus_local_initializers, install_client_local_initializers_internal, locus_local_initializer_digest } from "../locus/locus.local-initializer.js";
import { decode_locus_live_projected_envelope_internal, type LocusLiveProjectedWireEnvelope } from "../locus/locus.live-projection.js";
import { AUTHORITY_PROJECTION_SNAPSHOT_FORMAT, admit_authority_projection_snapshot, authority_projection_as_client_composition_internal, bind_client_projection_identity_internal, replace_client_projection_identity_internal, advance_client_projection_identity_internal, client_projection_identity_internal, client_projection_features_internal } from "../locus/locus.authority-projection-snapshot.js";
import { locus_projection_contract_digest } from "../locus/locus.projection.js";
import {
  create_echo_semantic_connection_internal,
  type EchoEndpointConnection,
} from "./echo.client.js";
import type {
  LocusHostedAggregateSynchronizationRequest,
} from "../locus/locus.aggregate.transport.internal.js";
import {
  create_echo_aggregate_replica_capability_internal,
  type EchoAggregateReplicaCapability,
} from "./echo.aggregate-replica.lifecycle.js";
import type { EchoSynchronizationOutput } from "../../types/echo.transport.types.js";


type HostedPlanOutcome = "current" | "replay" | "reconcile" | "reject";
type AggregateSynchronizationOutput = EchoSynchronizationOutput;

/** @internal */
export type EchoAggregateClientOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  transport: EchoReplicaTransport<TActions>;
  /** Required for an unbootstrapped Echo; an existing mirror supplies it. */
  logicalMapId?: string;
  /** An existing aggregate mirror is restored in place during snapshot recovery. */
  map?: LiveMap;
  clientId?: string;
  actionId?: () => string;
  actionAttemptId?: () => string;
  actionStatusId?: () => string;
  session?: EchoSessionOptions;
  /** @internal Common public Echo shell supplied by deferred replica composition. */
  connection?: EchoEndpointConnection<TActions>;
  /** @internal Management acquired synchronously by the public Echo shell. */
  management?: EchoMapManagementLease;
  /** Unverified transferred current-state evidence; cleared after the first caught-up synchronization. */
  initialStateFingerprint?: string;
  initialInitializerDigest?: string;
  initialSessionBinding?: string;
  /** @internal Already-admitted session-authorized initializer definitions. */
  initializers?: readonly import("../../types/locus.projection.types.js").LocusLocalInitializer[];
}>;

/** @internal */
export type EchoAggregateRecovery = Readonly<{
  outcome: Exclude<HostedPlanOutcome, "reject">;
  revision: number;
}>;

/** @internal */
export type EchoAggregateClient = Readonly<{
  /** Undefined until an aggregate bootstrap snapshot has passed every validation check. */
  readonly map: LiveMap | undefined;
  readonly logicalMapId: string;
  readonly incarnationId: string | undefined;
  readonly registryDigest: string | undefined;
  readonly lastAppliedRev: number | undefined;
  readonly lastRecoveryOutcome: Exclude<HostedPlanOutcome, "reject"> | undefined;
  observeAuthorityPosition: (listener: (revision: number) => void) => LocusDisposer;
  /** @internal Exact aggregate replica owner used by full-Echo composition. */
  readonly replica: EchoAggregateReplicaCapability;
  readonly clientId: string;
  readonly session: EchoSession;
  /** @internal Direct aggregate synchronization orchestration for mechanism proofs. */
  connect: () => Promise<EchoAggregateRecovery>;
  attachTransport: () => LocusDisposer;
  disconnect: () => void;
  recover: () => Promise<EchoAggregateRecovery>;
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
export function create_echo_aggregate_client_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoAggregateClientOptions<TActions>): EchoAggregateClient {
  if (options.connection !== undefined) {
    return create_registry_echo_semantic_client_internal(Object.freeze({ ...options, connection: options.connection }), false);
  }
  const connection = create_echo_semantic_connection_internal<TActions>({
    transport: options.transport,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ids: {
      ...(options.actionId === undefined ? {} : { actionId: options.actionId }),
      ...(options.actionAttemptId === undefined ? {} : { actionAttemptId: options.actionAttemptId }),
      ...(options.actionStatusId === undefined ? {} : { actionStatusId: options.actionStatusId }),
    },
    actionMessageId: "attempt",
    operationLossError: (reason) => new Error(reason === "ended"
      ? "Hosted aggregate Echo session ended before the pending operation completed."
      : reason === "fenced"
        ? "Hosted aggregate session attachment was fenced."
        : "Hosted aggregate transport interrupted."),
  });
  return create_registry_echo_semantic_client_internal(Object.freeze({ ...options, connection }), true);
}

function create_registry_echo_semantic_client_internal<
  TActions extends LocusActionPayloads,
>(
  options: EchoAggregateClientOptions<TActions> & Readonly<{
    connection: EchoEndpointConnection<TActions>;
  }>,
  ownsConnection: boolean,
): EchoAggregateClient {
  let map = options.map;
  const replica = create_echo_aggregate_replica_capability_internal(map, options.management);
  let logicalMapId = options.logicalMapId;
  let incarnationId: string | undefined;
  let registryDigest: string | undefined;
  let projectionDigest: string | undefined = map === undefined ? undefined : client_projection_identity_internal(map);
  let projectionSequence = 0;
  let initialStateFingerprint = options.initialStateFingerprint;
  const initializers = admit_locus_local_initializers(options.initializers ?? []);
  let initialInitializerDigest = options.initialInitializerDigest
    ?? (options.initializers === undefined ? undefined : locus_local_initializer_digest(initializers));
  let initialSessionBinding = options.initialSessionBinding;
  let projectionFeatures: readonly string[] = map === undefined ? [] : client_projection_features_internal(map) ?? [];
  let authorityRev: number | undefined;
  const authorityPositionListeners = new Set<(revision: number) => void>();
  const publishAuthorityPosition = (): void => {
    if (authorityRev === undefined) return;
    for (const listener of [...authorityPositionListeners]) listener(authorityRev);
  };
  if (map !== undefined) {
    const projection = replica.clientProjection();
    const snapshot = projection === undefined ? replica.hostedPosition() : undefined;
    logicalMapId ??= projection?.authority.logicalMapId ?? snapshot?.authority.logicalMapId;
    incarnationId = projection?.authority.incarnationId ?? snapshot?.authority.incarnationId;
    registryDigest = projection?.registry.digest ?? snapshot?.registryDigest;
    authorityRev = projection?.revision ?? snapshot?.revision;
  }
  if (logicalMapId === undefined || logicalMapId.length === 0) {
    replica.dispose();
    throw new Error("Hosted aggregate Echo requires logicalMapId before bootstrap.");
  }
  const clientLogicalMapId = logicalMapId;
  let status: "idle" | "recovering" | "live" | "failed" | "closed" = "idle";
  let attachmentAvailable = false;
  let syncSubscription: EchoSynchronizationSubscription | undefined;
  let openingRecovery: Readonly<{ id: string; controller: AbortController }> | undefined;
  const compositionDisposers: LocusDisposer[] = [];
  let nextId = 0;
  let recovery: Readonly<{
    id: string;
    sessionId: string;
    sessionEpoch: number;
    resolve: (value: EchoAggregateRecovery) => void;
    reject: (reason: Error) => void;
    outcome?: Exclude<HostedPlanOutcome, "reject">;
    projectionDigest?: string;
    projectionSequence?: number;
    registryDigest?: string;
    snapshotReceived: boolean;
  }> | undefined;
  let liveRecovery: Readonly<{ id: string; sessionId: string; sessionEpoch: number }> | undefined;
  let lastRecoveryOutcome: Exclude<HostedPlanOutcome, "reject"> | undefined;
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | undefined;
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();

  const endpoint = options.connection.endpoint;
  const clientId = endpoint.clientId;

  compositionDisposers.push(options.connection.onAttachmentLost((reason, error) => {
    if (reason !== "disconnect") interruptRecovery(error);
  }));
  compositionDisposers.push(options.connection.onAvailabilityChange((nextConnected) => {
      if (nextConnected) {
        attachmentAvailable = true;
        return;
      }
      if (!attachmentAvailable) return;
      attachmentAvailable = false;
      const error = new Error("Hosted aggregate Echo disconnected.");
      interruptRecovery(error);
      syncSubscription?.cancel();
      syncSubscription = undefined;
      replica.markRecovering();
      if (status !== "closed") status = "idle";
  }));

  function onSyncEnd(id: string, end: EchoSynchronizationEnd): void {
    if (recovery?.id !== id && liveRecovery?.id !== id) return;
    const failedWhileOpening = openingRecovery?.id === id;
    syncSubscription = undefined;
    if (status === "closed" || end.kind === "cancelled") return;
    const error = end.cause instanceof Error ? end.cause : new Error("Hosted aggregate synchronization interrupted.");
    if (end.kind === "invalid") { failReplica(error); return; }
    interruptRecovery(error);
    replica.markRecovering();
    status = "idle";
    const retry = () => {
      recoveryRetryTimer = undefined;
      if (attachmentAvailable && status === "idle" && endpoint.session.status === "attached") {
        void recover_feed().catch(() => {});
      }
    };
    if (failedWhileOpening) recoveryRetryTimer = setTimeout(retry, 1000);
    else queueMicrotask(retry);
  }

  function next(prefix: string): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
  }

  function interruptRecovery(error: Error): void {
    if (recoveryRetryTimer !== undefined) { clearTimeout(recoveryRetryTimer); recoveryRetryTimer = undefined; }
    const active = recovery;
    recovery = undefined;
    liveRecovery = undefined;
    openingRecovery?.controller.abort(error);
    openingRecovery = undefined;
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

  function disconnect(): void {
    options.connection.echo.disconnect();
  }

  function attachTransport(): LocusDisposer {
    return options.connection.echo.connect();
  }

  function recover_feed(): Promise<EchoAggregateRecovery> {
    if (recoveryRetryTimer !== undefined) { clearTimeout(recoveryRetryTimer); recoveryRetryTimer = undefined; }
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate Echo is closed."));
    if (!attachmentAvailable) return Promise.reject(new Error("Hosted aggregate synchronization requires a connected transport."));
    if (recovery !== undefined) return Promise.reject(new Error("Hosted aggregate synchronization is already in progress."));
    if (endpoint.session.status !== "attached" || endpoint.session.sessionId === undefined || endpoint.session.epoch === undefined) {
      return Promise.reject(new Error("Hosted aggregate synchronization requires an attached session."));
    }
    if (endpoint.session.logicalMapId !== clientLogicalMapId) {
      return Promise.reject(new Error("Hosted aggregate session authority does not match the configured synchronization target."));
    }
    if (map !== undefined) {
      const projection = replica.clientProjection();
      if (projection !== undefined) {
        incarnationId = projection.authority.incarnationId;
        registryDigest = projection.registry.digest;
      } else {
        const snapshot = replica.hostedPosition();
        incarnationId = snapshot.authority.incarnationId;
        registryDigest = snapshot.registryDigest;
      }
      projectionDigest = client_projection_identity_internal(map);
    }
    status = "recovering";
    replica.markRecovering();
    const id = next("recover");
    const controller = new AbortController();
    openingRecovery = Object.freeze({ id, controller });
    const recoverySessionId = endpoint.session.sessionId;
    const recoverySessionEpoch = endpoint.session.epoch;
    return new Promise<EchoAggregateRecovery>((resolve, reject) => {
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
        ...(incarnationId === undefined || registryDigest === undefined || projectionDigest === undefined || authorityRev === undefined
          ? {}
          : { cursor: Object.freeze({ incarnationId, registryDigest, projectionDigest,
            projectionSequence, lastAppliedRev: authorityRev,
            ...(initialStateFingerprint === undefined ? {} : { initialStateFingerprint }),
            ...(initialInitializerDigest === undefined ? {} : { initialInitializerDigest }),
            ...(initialSessionBinding === undefined ? {} : { initialSessionBinding }) }) }),
      });
      void options.transport.synchronization.open(request, Object.freeze({
        onOutput(output) {
          if (recovery?.id !== id && liveRecovery?.id !== id) return;
          try { receiveReplica(output); }
          catch (cause) { failReplica(cause instanceof Error ? cause : new Error("Hosted aggregate replica failed.")); }
        },
        onEnd: (end) => onSyncEnd(id, end),
      }), { signal: controller.signal }).then((subscription) => {
        if (openingRecovery?.id === id) openingRecovery = undefined;
        if (status === "closed" || (recovery?.id !== id && liveRecovery?.id !== id)) subscription.cancel();
        else syncSubscription = subscription;
      }, (cause) => {
        if (openingRecovery?.id === id) openingRecovery = undefined;
        onSyncEnd(id, Object.freeze({ kind: "interrupted", cause }));
      });
    });
  }

  async function connect_client(): Promise<EchoAggregateRecovery> {
    attachTransport();
    if (endpoint.session.status !== "attached") {
      if (endpoint.session.credential === undefined) await endpoint.session.create();
      else await endpoint.session.reattach(endpoint.session.credential);
    }
    return recover_feed();
  }

  function receiveReplica(message: AggregateSynchronizationOutput): void {
    if (message.type === "synchronization-failure") {
      if (recovery?.id !== message.id && liveRecovery?.id !== message.id) return;
      const error = new Error(message.error.message);
      // Preserve the control channel so failed establishment can detach the
      // retained server session without revoking it.
      failReplica(error);
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
      if (incarnationId === message.incarnationId && projectionDigest !== undefined
        && message.outcome !== "reconcile" && message.projectionDigest !== projectionDigest) {
        throw new Error("Hosted recovery projection is incompatible.");
      }
      if (incarnationId === message.incarnationId && registryDigest !== undefined
        && message.outcome !== "reconcile" && message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery projected registry mismatch.");
      }
      if (recoveryCurrent(active)) recovery = Object.freeze({ ...active, outcome: message.outcome,
        projectionDigest: message.projectionDigest, registryDigest: message.registryDigest,
        projectionSequence: message.projectionSequence ?? 0 });
      return;
    }
    if (message.type === "recovery-snapshot") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "reconcile") throw new Error("Hosted recovery received an unexpected aggregate snapshot.");
      install_snapshot(message.snapshot);
      if (recoveryCurrent(active)) recovery = Object.freeze({ ...active, snapshotReceived: true });
      return;
    }
    if (message.type === "recovery-commit") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "reconcile") throw new Error("Hosted recovery received an unexpected aggregate commit.");
      assert_projection_message(message, active);
      apply_live_envelope(message.commit);
      return;
    }
    if (message.type === "recovery-progress") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "reconcile") throw new Error("Hosted recovery received unexpected authority progress.");
      assert_projection_message(message, active);
      apply_progress(message.progress, false);
      return;
    }
    if (message.type === "commit") {
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      assert_projection_message(message);
      apply_live_envelope(message.commit);
      return;
    }
    if (message.type === "progress") {
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      assert_projection_message(message);
      apply_progress(message.progress, true);
      return;
    }
    if (message.type === "projection-change") {
      const recovering = current_recovery(message.id);
      if (recovering !== undefined && recovering.outcome !== "reconcile") {
        apply_projection_change(message, true);
        return;
      }
      const active = liveRecovery;
      if (status !== "live" || active === undefined || active.id !== message.id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId
        || endpoint.session.epoch !== active.sessionEpoch) return;
      apply_projection_change(message);
      return;
    }
    if (message.type === "recovery-caught-up") {
      const active = current_recovery(message.id);
      if (active === undefined) return;
      if (message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId
        || message.registryDigest !== registryDigest || message.projectionDigest !== projectionDigest) {
        throw new Error("Hosted recovery caught-up fence is incompatible with this mirror.");
      }
      if (authorityRev !== message.throughRev) {
        throw new Error("Hosted recovery caught-up authority revision does not match the Echo cursor.");
      }
      if ((message.projectionSequence ?? 0) !== (active.outcome === "reconcile"
        ? (active.projectionSequence ?? 0) : projectionSequence)) {
        throw new Error("Hosted recovery projection sequence is incompatible.");
      }
      projectionSequence = message.projectionSequence ?? 0;
      initialStateFingerprint = undefined;
      initialInitializerDigest = undefined;
      initialSessionBinding = undefined;
      status = "live";
      lastRecoveryOutcome = active.outcome ?? "current";
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
    throw new Error("Unknown hosted aggregate synchronization output.");
  }

  function assert_projection_message(message: Readonly<{ projectionSequence: number; projectionDigest: string }>,
    active?: NonNullable<typeof recovery>): void {
    const expectedSequence = active?.outcome === "reconcile" ? active.projectionSequence : projectionSequence;
    if (message.projectionSequence !== expectedSequence || message.projectionDigest !== projectionDigest) {
      throw new Error("Hosted authority message projection fence is incompatible.");
    }
  }

  function current_recovery(id: string): NonNullable<typeof recovery> | undefined {
    const active = recovery;
    if (active === undefined || active.id !== id || !recoveryCurrent(active)) return undefined;
    return active;
  }

  function install_snapshot(input: AuthorityProjectionSnapshot): void {
    const snapshot = admit_authority_projection_snapshot(input);
    const active = recovery;
    if (active?.outcome !== "reconcile" || active.projectionDigest !== snapshot.projectionDigest
      || snapshot.authority.logicalMapId !== clientLogicalMapId
      || snapshot.authority.incarnationId !== endpoint.session.incarnationId) {
      throw new Error("Hosted projected snapshot fence is incompatible.");
    }
    const composition = authority_projection_as_client_composition_internal(snapshot);
    if (active.registryDigest !== composition.registryDigest) throw new Error("Hosted projected snapshot registry is incompatible.");
    if (map === undefined) {
      if (composition.registry.libraries.length > 0 || initializers.length > 0) {
        const created = make_livemap_client_composition_from_portable_aggregate_internal(composition);
        install_client_local_initializers_internal(created, initializers);
        replica.attachMap(created);
        map = created;
      }
    } else {
      if (replica.clientProjection() === undefined) throw new Error("Hosted projected restore requires a composed client LiveMap.");
      replica.restoreHosted(composition);
    }
    if (map !== undefined) {
      if (client_projection_identity_internal(map) === undefined) bind_client_projection_identity_internal(map, snapshot);
      else replace_client_projection_identity_internal(map, projectionDigest, snapshot);
    }
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = composition.registryDigest;
    projectionDigest = snapshot.projectionDigest;
    projectionFeatures = snapshot.systemFeatures;
    authorityRev = snapshot.revision;
    publishAuthorityPosition();
  }

  function apply_projection_change(message: import("../locus/locus.aggregate.transport.internal.js").LocusHostedProjectionChange,
    recovering = false): void {
    if (authorityRev === undefined || projectionDigest === undefined
      || registryDigest === undefined || incarnationId === undefined
      || message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId
      || message.authorityRev !== authorityRev
      || (recovering ? message.sequence <= projectionSequence : message.sequence !== projectionSequence + 1)
      || message.previousDigest !== projectionDigest
      || (message.reconciliation === undefined
        && JSON.stringify(message.systemFeatures) !== JSON.stringify(projectionFeatures))) {
      throw new Error("Hosted projection change fence is incompatible.");
    }
    const nextDigest = locus_projection_contract_digest(Object.freeze({ logicalMapId: clientLogicalMapId, incarnationId }),
      message.libraries, message.systemFeatures, message.writableDocuments);
    if (nextDigest !== message.projectionDigest) throw new Error("Hosted projection change digest is incompatible.");
    if (message.reconciliation !== undefined) {
      if (message.topology !== undefined || message.system !== undefined) {
        throw new Error("Hosted projection reconciliation is ambiguous.");
      }
      const snapshot = admit_authority_projection_snapshot(message.reconciliation);
      const composition = authority_projection_as_client_composition_internal(snapshot);
      if (snapshot.authority.logicalMapId !== clientLogicalMapId
        || snapshot.authority.incarnationId !== incarnationId
        || snapshot.revision !== authorityRev || snapshot.projectionDigest !== nextDigest
        || composition.registryDigest !== message.registryDigest
        || JSON.stringify(snapshot.libraries.map(({ root: _root, css: _css, schema: _schema, ...entry }) => entry))
          !== JSON.stringify(message.libraries.map(({ schema: _schema, ...entry }) => entry))
        || JSON.stringify(snapshot.systemFeatures) !== JSON.stringify(message.systemFeatures)
        || JSON.stringify(snapshot.writableDocuments) !== JSON.stringify(message.writableDocuments)) {
        throw new Error("Hosted projection reconciliation fence is incompatible.");
      }
      if (map === undefined) {
        if (composition.registry.libraries.length > 0 || initializers.length > 0) {
          const created = make_livemap_client_composition_from_portable_aggregate_internal(composition);
          install_client_local_initializers_internal(created, initializers);
          replica.attachMap(created);
          map = created;
          bind_client_projection_identity_internal(created, snapshot);
        }
      } else {
        replica.restoreHosted(composition);
        advance_client_projection_identity_internal(map, incarnationId, projectionDigest, nextDigest, message.systemFeatures);
      }
      projectionDigest = nextDigest;
      registryDigest = message.registryDigest;
      projectionFeatures = message.systemFeatures;
      projectionSequence = message.sequence;
      if (map !== undefined) install_client_local_initializers_internal(map, message.local);
      return;
    }
    const current = replica.clientProjection();
    if ((map === undefined && !recovering) || (map !== undefined && current === undefined)) {
      throw new Error("Hosted projection change requires a composed client map.");
    }
    const oldEntries = current?.registry.libraries.filter((entry) => entry.scope === undefined) ?? [];
    for (const old of oldEntries) {
      const next = message.libraries.find((entry) => entry.name === old.name);
      if (next === undefined || next.mode !== old.mode || hson_schema_source_digest(next.schema) !== hson_schema_source_digest(old.schema)
        || next.schemaDigest !== old.schemaDigest || next.rootCodec !== old.rootCodec) {
        throw new Error("Hosted projection change cannot replace an existing Library contract.");
      }
    }
    const oldNames = new Set(oldEntries.map((entry) => entry.name));
    const added = message.libraries.filter((entry) => !oldNames.has(entry.name));
    if (added.length === 0) {
      if (map === undefined || message.topology !== undefined || message.system !== undefined
        || message.registryDigest !== registryDigest) {
        throw new Error("Hosted projection change topology is incompatible.");
      }
    } else {
      const topology = message.topology;
      if (topology === undefined || topology.operation.kind !== "library-add"
        || topology.operation.libraries.length !== added.length
        || topology.operation.libraries.some((entry, index) => {
          const contract = added[index];
          return contract === undefined || entry.name !== contract.name || entry.mode !== contract.mode
            || hson_schema_source_digest(entry.schema) !== hson_schema_source_digest(contract.schema);
        })) throw new Error("Hosted projection change lacks its exact Library addition.");
      if (added.some((entry) => entry.mode === "document") && projectionFeatures.includes("interactions")
        && message.system === undefined) throw new Error("Hosted projection change lacks projected interactions.");
      if (!projectionFeatures.includes("interactions") && message.system !== undefined) {
        throw new Error("Hosted projection change has unexpected interactions.");
      }
      if (map === undefined) {
        const empty = admit_authority_projection_snapshot(Object.freeze({
          format: AUTHORITY_PROJECTION_SNAPSHOT_FORMAT,
          authority: Object.freeze({ logicalMapId: clientLogicalMapId, incarnationId }),
          revision: authorityRev, projectionDigest, libraries: Object.freeze([]),
          systemFeatures: Object.freeze([]), writableDocuments: Object.freeze([]), system: null,
        }));
        const composition = authority_projection_as_client_composition_internal(empty);
        if (composition.registryDigest !== registryDigest) throw new Error("Empty projected topology fence is incompatible.");
        const created = make_livemap_libraries({}, [], composition);
        replica.attachMap(created);
        map = created;
        bind_client_projection_identity_internal(created, empty);
      }
      replica.installProjectedTopology(topology, message.registryDigest, message.system);
      if (replica.clientProjection()?.registry.digest !== message.registryDigest) {
        throw new Error("Hosted projection topology installation is incomplete.");
      }
    }
    if (map === undefined) throw new Error("Hosted projection change requires a composed client map.");
    advance_client_projection_identity_internal(map, incarnationId, projectionDigest, message.projectionDigest, message.systemFeatures);
    projectionDigest = message.projectionDigest;
    registryDigest = message.registryDigest;
    projectionFeatures = message.systemFeatures;
    projectionSequence = message.sequence;
    install_client_local_initializers_internal(map, message.local);
  }

  function apply_live_envelope(envelope: LocusLiveProjectedWireEnvelope): void {
    if (incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Projected live commit requires a hosted bootstrap.");
    }
    const liveDigest = replica.clientProjection()?.registry.digest ?? registryDigest;
    const admitted = decode_locus_live_projected_envelope_internal(envelope, Object.freeze({
      logicalMapId: clientLogicalMapId, incarnationId, registryDigest: liveDigest,
    }));
    if (authorityRev === undefined || admitted.prevRev !== authorityRev) {
      throw new Error("Projected live commit is not contiguous with the Echo authority cursor.");
    }
    if (admitted.topology !== undefined) {
      if (map === undefined || admitted.previousRegistryDigest !== registryDigest
        || admitted.operations.length !== 0) {
        throw new Error("Projected topology commit is incompatible with this Echo map.");
      }
      replica.installProjectedTopology(admitted.topology, admitted.registryDigest);
      replica.advanceHostedProgress(Object.freeze({ logicalMapId: clientLogicalMapId,
        incarnationId, registryDigest: admitted.registryDigest,
        prevRev: admitted.prevRev, rev: admitted.rev }));
      registryDigest = admitted.registryDigest;
      authorityRev = admitted.rev;
      publishAuthorityPosition();
      return;
    }
    const commit = Object.freeze({ ...admitted, registryDigest });
    if (map !== undefined) replica.replayHosted(commit, authorityRev);
    authorityRev = commit.rev;
    publishAuthorityPosition();
  }

  function apply_progress(progress: import("../locus/locus.aggregate.transport.internal.js").LocusHostedAggregateProgress, live: boolean): void {
    if (incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Hosted authority progress arrived before aggregate bootstrap.");
    }
    const expectedDigest = registryDigest;
    if (progress.logicalMapId !== clientLogicalMapId || progress.incarnationId !== incarnationId
      || progress.registryDigest !== expectedDigest) throw new Error("Hosted authority progress fence is incompatible.");
    if (authorityRev === undefined || progress.prevRev !== authorityRev
      || !Number.isSafeInteger(progress.prevRev) || progress.prevRev < 0
      || progress.rev !== progress.prevRev + 1) {
      throw new Error("Hosted progress is not contiguous with the Echo authority cursor.");
    }
    if (map !== undefined) replica.advanceHostedProgress(progress);
    authorityRev = progress.rev;
    publishAuthorityPosition();
  }

  function wait_until_ready(): Promise<void> {
    if (status === "live" && endpoint.ready) return Promise.resolve();
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate Echo is closed."));
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
    get lastRecoveryOutcome() { return lastRecoveryOutcome; },
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
    recover: recover_feed,
    action: action as EchoAggregateClient["action"],
    retryAction: retryAction as EchoAggregateClient["retryAction"],
    actionStatus,
    wait_until_ready,
    dispose: () => {
      if (status === "closed") return;
      status = "closed";
      syncSubscription?.cancel();
      syncSubscription = undefined;
      if (ownsConnection) disconnect();
      const error = new Error("Hosted aggregate Echo is closed.");
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
