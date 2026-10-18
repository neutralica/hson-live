import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
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
  /** Internal direct-replay harness publishes installed progress synchronously. */
  scopedReconciliation?: boolean;
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
  if (options.scopedReconciliation && map === undefined) throw new Error("Private scoped recovery requires an initial composed map.");
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
  const publishAuthorityPosition = (assertCurrent?: () => void): void => {
    if (authorityRev === undefined) return;
    for (const listener of [...authorityPositionListeners]) {
      assertCurrent?.();
      listener(authorityRev);
    }
    assertCurrent?.();
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
  // Keep the cursor current before installation listeners can accept another
  // message. Private scoped replay also publishes directly through this seam.
  function observeInstalledPosition(installedMap: LiveMap): void {
    compositionDisposers.push(internal_livemap_aggregate_authority(installedMap).observeAuthorityPosition(() => {
      authorityRev = replica.clientProjection()?.revision ?? replica.hostedPosition().revision;
      if (options.scopedReconciliation) publishAuthorityPosition();
    }, "installed"));
  }
  if (map !== undefined) observeInstalledPosition(map);
  let nextId = 0;
  let recovery: Readonly<{
    id: string;
    sessionId: string;
    sessionEpoch: number;
    assertManagement: () => void;
    resolve: (value: EchoAggregateRecovery) => void;
    reject: (reason: Error) => void;
    outcome?: Exclude<HostedPlanOutcome, "reject">;
    projectionDigest?: string;
    projectionSequence?: number;
    registryDigest?: string;
    snapshotReceived: boolean;
    snapshotReceiving?: boolean;
    completing?: boolean;
    headRev?: number;
  }> | undefined;
  let liveRecovery: Readonly<{ id: string; sessionId: string; sessionEpoch: number; assertManagement: () => void }> | undefined;
  let lastRecoveryOutcome: Exclude<HostedPlanOutcome, "reject"> | undefined;
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | undefined;
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();

  const endpoint = options.connection.endpoint;
  const clientId = endpoint.clientId;

  function onSessionStateChange(): void {
    if (endpoint.session.status !== "disposed" || status === "closed" || replica.disposed) return;
    const error = new Error("Hosted aggregate Echo session is disposed.");
    // The session owns terminality. Reuse the existing failure and replica
    // disposal machinery, including waiter rejection and management release.
    try { interruptRecovery(error, true, true); }
    finally { replica.dispose(); }
  }
  compositionDisposers.push(options.connection.onReadyChange(onSessionStateChange));
  onSessionStateChange();
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
      interruptRecovery(error, false, true);
  }));

  function onSyncEnd(id: string, input: EchoSynchronizationEnd): void {
    const active = recovery ?? liveRecovery;
    if (active?.id !== id) return;
    const stillOwns = () => recovery === active || liveRecovery === active;
    let end: EchoSynchronizationEnd, error: Error;
    try {
      const assertManagement = replica.captureManagementFence();
      end = Object.freeze({ kind: input.kind, cause: input.cause });
      error = end.cause instanceof Error ? end.cause : new Error("Hosted aggregate synchronization interrupted.");
      assertManagement(); active.assertManagement();
    } catch (cause) {
      if (stillOwns()) failReplica(cause instanceof Error ? cause : new Error("Hosted synchronization end was revoked."));
      return;
    }
    if (!stillOwns()) return;
    const failedWhileOpening = openingRecovery?.id === id;
    syncSubscription = undefined;
    if (status === "closed" || end.kind === "cancelled") return;
    if (end.kind === "invalid") { failReplica(error); return; }
    const retryGeneration = nextId;
    const retryEligible = () => {
      if (nextId !== retryGeneration || recovery !== undefined || liveRecovery !== undefined
        || status !== "idle" || replica.disposed || !attachmentAvailable
        || endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId
        || endpoint.session.epoch !== active.sessionEpoch) return false;
      try { active.assertManagement(); return true; }
      catch { return false; }
    };
    try { interruptRecovery(error); }
    finally {
      // Notification errors still propagate to synchronous callers, after this
      // invocation has secured its eligible retry. Never adopt a callback's grant.
      if (retryEligible()) {
        const retry = () => {
          if (!retryEligible()) return;
          recoveryRetryTimer = undefined;
          void recover_feed().catch(() => {});
        };
        if (failedWhileOpening) recoveryRetryTimer = setTimeout(retry, 1000);
        else queueMicrotask(retry);
      }
    }
  }

  function next(prefix: string): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
  }

  function interruptRecovery(error: Error, failed = false, cancelSubscription = false): void {
    if (recoveryRetryTimer !== undefined) { clearTimeout(recoveryRetryTimer); recoveryRetryTimer = undefined; }
    const active = recovery, opening = openingRecovery;
    // Attachment fencing and failed establishment retain the control channel
    // for session reattachment/detach. Transport loss and terminal session
    // disposal cancel that binding.
    const subscription = cancelSubscription ? syncSubscription : undefined;
    const waiters = failed ? [...readyWaiters] : [];
    if (failed) readyWaiters.clear();
    // Detach every resource of this invocation before application callbacks can
    // open a replacement. The remaining cleanup uses only captured resources.
    recovery = undefined;
    liveRecovery = undefined;
    openingRecovery = undefined;
    if (cancelSubscription) syncSubscription = undefined;
    const publish = status !== "closed" && (failed || status === "recovering" || status === "live");
    if (publish) status = failed ? "failed" : "idle";
    active?.reject(error);
    for (const waiter of waiters) waiter.reject(error);
    try {
      if (publish) {
        if (failed) replica.markFailed(error);
        else replica.markRecovering();
      }
    } finally {
      try { opening?.controller.abort(error); }
      finally { subscription?.cancel(); }
    }
  }

  function recoveryCurrent(active: NonNullable<typeof recovery>): boolean {
    return recovery === active
      && endpoint.session.status === "attached"
      && endpoint.session.sessionId === active.sessionId
      && endpoint.session.epoch === active.sessionEpoch;
  }

  function failReplica(error: Error): void {
    if (status === "closed" || status === "failed") return;
    interruptRecovery(error, true);
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
    if (endpoint.session.status === "disposed") return Promise.reject(new Error("Hosted aggregate Echo session is disposed."));
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
        authorityRev = projection.revision;
      } else {
        const snapshot = replica.hostedPosition();
        incarnationId = snapshot.authority.incarnationId;
        registryDigest = snapshot.registryDigest;
      }
      projectionDigest = client_projection_identity_internal(map);
    }
    const assertManagement = replica.captureManagementFence();
    const id = next("recover");
    const controller = new AbortController();
    liveRecovery = undefined;
    openingRecovery = Object.freeze({ id, controller });
    const recoverySessionId = endpoint.session.sessionId;
    const recoverySessionEpoch = endpoint.session.epoch;
    return new Promise<EchoAggregateRecovery>((resolve, reject) => {
      recovery = Object.freeze({
        id,
        sessionId: recoverySessionId,
        sessionEpoch: recoverySessionEpoch,
        assertManagement,
        resolve,
        reject,
        snapshotReceived: false,
      });
      const active = recovery;
      status = "recovering";
      try {
        replica.markRecovering();
        assertManagement();
        if (!recoveryCurrent(active)) throw new Error("Hosted recovery changed while opening.");
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("Hosted recovery failed while opening.");
        if (recovery === active) failReplica(error);
        reject(error);
        return;
      }
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
      const openFailed = (cause: unknown): void => {
        // Keep the opening identity until onSyncEnd chooses the existing retry
        // policy. Older failures cannot clear a callback's replacement opening.
        try { onSyncEnd(id, Object.freeze({ kind: "interrupted", cause })); }
        catch (error) { report_recovery_callback_failure(error); }
        finally { if (openingRecovery?.id === id) openingRecovery = undefined; }
      };
      try {
        void options.transport.synchronization.open(request, Object.freeze({
          onOutput(output) {
            if (recovery?.id !== id && liveRecovery?.id !== id) return;
            try { receiveReplica(output); }
            catch (cause) {
              // An older invocation cannot fail a replacement recovery opened by a callback.
              if (recovery?.id === id || liveRecovery?.id === id) {
                failReplica(cause instanceof Error ? cause : new Error("Hosted aggregate replica failed."));
              }
            }
          },
          onEnd: (end) => onSyncEnd(id, end),
        }), { signal: controller.signal }).then((subscription) => {
          if (openingRecovery?.id === id) openingRecovery = undefined;
          if (status === "closed" || (recovery?.id !== id && liveRecovery?.id !== id)) subscription.cancel();
          else syncSubscription = subscription;
        }, openFailed).catch(report_recovery_callback_failure);
      } catch (cause) { openFailed(cause); }
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
    // Retain the entry grant before even the envelope's discriminant can run caller code.
    const assertEntry = replica.captureRestorationFence();
    const assertManagement = replica.captureManagementFence();
    const entryRecovery = recovery, entryLive = liveRecovery;
    let invocation = entryRecovery ?? entryLive;
    const entryRevision = authorityRev, entryDigest = projectionDigest, entrySequence = projectionSequence;
    const assertInvocation = () => {
      assertManagement();
      invocation?.assertManagement();
      if (invocation === undefined || (invocation !== recovery && invocation !== liveRecovery)
        || endpoint.session.status !== "attached" || endpoint.session.sessionId !== invocation.sessionId
        || endpoint.session.epoch !== invocation.sessionEpoch) throw new Error("Hosted message invocation was revoked.");
    };
    const assertAdmission = () => {
      assertEntry(); assertInvocation();
      if (authorityRev !== entryRevision || projectionDigest !== entryDigest || projectionSequence !== entrySequence) {
        throw new Error("Hosted message position changed during admission.");
      }
    };
    const type = message.type;
    const id = message.id;
    // Stale receipts have no authority, including permission to fail a new feed.
    if (invocation === undefined || invocation.id !== id) return;
    assertInvocation();
    if (type === "synchronization-failure") {
      if (recovery?.id !== id && liveRecovery?.id !== id) return;
      const error = new Error(message.error.message);
      // Preserve the control channel so failed establishment can detach the
      // retained server session without revoking it.
      assertAdmission();
      failReplica(error);
      return;
    }
    if (type === "recovery-plan") {
      const active = current_recovery(id, entryRecovery);
      if (active === undefined) return;
      if (active.outcome !== undefined) throw new Error("Hosted recovery received a duplicate plan.");
      const outcome = message.outcome;
      if (outcome === "reject") throw new Error(message.error.message);
      const plan = Object.freeze({ headRev: message.headRev, logicalMapId: message.logicalMapId,
        incarnationId: message.incarnationId, outcome, projectionDigest: message.projectionDigest,
        registryDigest: message.registryDigest, projectionSequence: message.projectionSequence ?? 0 });
      if (!Number.isSafeInteger(plan.headRev) || plan.headRev < 0
        || (plan.incarnationId === incarnationId && authorityRev !== undefined && plan.headRev < authorityRev)) {
        throw new Error("Hosted recovery plan revision is stale or invalid.");
      }
      if (plan.logicalMapId !== clientLogicalMapId
        || plan.logicalMapId !== endpoint.session.logicalMapId
        || plan.incarnationId !== endpoint.session.incarnationId) {
        throw new Error("Hosted recovery plan authority fence is incompatible with the attached session.");
      }
      if ((plan.outcome !== "current" && plan.outcome !== "replay" && plan.outcome !== "reconcile")
        || !Number.isSafeInteger(plan.projectionSequence) || plan.projectionSequence < 0
        || (plan.outcome !== "reconcile" && plan.projectionSequence !== projectionSequence)) {
        throw new Error("Hosted recovery plan is invalid.");
      }
      if (incarnationId === plan.incarnationId && projectionDigest !== undefined
        && plan.outcome !== "reconcile" && plan.projectionDigest !== projectionDigest) {
        throw new Error("Hosted recovery projection is incompatible.");
      }
      if (incarnationId === plan.incarnationId && registryDigest !== undefined
        && plan.outcome !== "reconcile" && plan.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery projected registry mismatch.");
      }
      assertAdmission();
      if (!recoveryCurrent(active)) throw new Error("Hosted recovery attachment changed during plan admission.");
      recovery = Object.freeze({ ...active, outcome: plan.outcome, headRev: plan.headRev,
        projectionDigest: plan.projectionDigest, registryDigest: plan.registryDigest,
        projectionSequence: plan.projectionSequence });
      return;
    }
    if (type === "recovery-snapshot") {
      const active = current_recovery(id, entryRecovery);
      if (active === undefined) {
        if (liveRecovery?.id === id) throw new Error("Hosted recovery received a duplicate snapshot after completion.");
        return;
      }
      if (active.outcome !== "reconcile" || active.snapshotReceived || active.snapshotReceiving) throw new Error("Hosted recovery received an unexpected or duplicate aggregate snapshot.");
      // Reserve this single receipt before inspection; reentrant delivery cannot install another.
      const receiving = Object.freeze({ ...active, snapshotReceiving: true });
      recovery = receiving;
      invocation = receiving;
      install_snapshot(message.snapshot, receiving, assertAdmission, assertInvocation);
      if (recoveryCurrent(receiving)) recovery = Object.freeze({ ...receiving, snapshotReceiving: false, snapshotReceived: true });
      return;
    }
    if (type === "recovery-commit") {
      const active = current_recovery(id, entryRecovery);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "reconcile") throw new Error("Hosted recovery received an unexpected aggregate commit.");
      if (active.outcome === "reconcile" && !active.snapshotReceived) throw new Error("Hosted reconciliation snapshot is missing.");
      assert_projection_message(message, active);
      apply_live_envelope(message.commit, assertAdmission, assertInvocation);
      return;
    }
    if (type === "recovery-progress") {
      const active = current_recovery(id, entryRecovery);
      if (active === undefined) return;
      if (active.outcome !== "replay" && active.outcome !== "reconcile") throw new Error("Hosted recovery received unexpected authority progress.");
      if (active.outcome === "reconcile" && !active.snapshotReceived) throw new Error("Hosted reconciliation snapshot is missing.");
      assert_projection_message(message, active);
      apply_progress(message.progress, assertAdmission, assertInvocation);
      return;
    }
    if (type === "commit") {
      const active = entryLive;
      if (status !== "live" || active === undefined || active.id !== id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      assert_projection_message(message);
      apply_live_envelope(message.commit, assertAdmission, assertInvocation);
      return;
    }
    if (type === "progress") {
      const active = entryLive;
      if (status !== "live" || active === undefined || active.id !== id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId || endpoint.session.epoch !== active.sessionEpoch) return;
      assert_projection_message(message);
      apply_progress(message.progress, assertAdmission, assertInvocation);
      return;
    }
    if (type === "projection-change") {
      const recovering = current_recovery(id, entryRecovery);
      if (recovering !== undefined && recovering.outcome !== "reconcile") {
        apply_projection_change(message, assertAdmission, assertInvocation, true);
        return;
      }
      const active = entryLive;
      if (status !== "live" || active === undefined || active.id !== id) return;
      if (endpoint.session.status !== "attached" || endpoint.session.sessionId !== active.sessionId
        || endpoint.session.epoch !== active.sessionEpoch) return;
      apply_projection_change(message, assertAdmission, assertInvocation);
      return;
    }
    if (type === "recovery-caught-up") {
      const active = current_recovery(id, entryRecovery);
      if (active === undefined) return;
      if (active.completing) throw new Error("Hosted recovery received a reentrant completion.");
      const completing = Object.freeze({ ...active, completing: true });
      recovery = completing;
      invocation = completing;
      const evidence = Object.freeze({ throughRev: message.throughRev, logicalMapId: message.logicalMapId,
        incarnationId: message.incarnationId, registryDigest: message.registryDigest,
        projectionDigest: message.projectionDigest, projectionSequence: message.projectionSequence ?? 0 });
      const assertCompletion = () => {
        assertAdmission();
        if (!recoveryCurrent(completing)) throw new Error("Hosted recovery attachment changed during completion.");
        const installed = replica.clientProjection();
        if (installed !== undefined && (installed.revision !== authorityRev
          || installed.authority.logicalMapId !== clientLogicalMapId || installed.authority.incarnationId !== incarnationId
          || installed.registry.digest !== registryDigest)) throw new Error("Hosted recovery installed position is incompatible.");
      };
      assertCompletion();
      if (active.outcome === undefined || (active.outcome === "reconcile" && !active.snapshotReceived)
        || active.headRev === undefined || !Number.isSafeInteger(evidence.throughRev)
        || evidence.throughRev < active.headRev) throw new Error("Hosted recovery has not established its announced cut.");
      if (evidence.logicalMapId !== clientLogicalMapId || evidence.incarnationId !== incarnationId
        || evidence.registryDigest !== registryDigest || evidence.projectionDigest !== projectionDigest) {
        throw new Error("Hosted recovery caught-up fence is incompatible with this mirror.");
      }
      if (authorityRev !== evidence.throughRev) {
        throw new Error("Hosted recovery caught-up authority revision does not match the Echo cursor.");
      }
      if (evidence.projectionSequence !== (active.outcome === "reconcile"
        ? (active.projectionSequence ?? 0) : projectionSequence)) {
        throw new Error("Hosted recovery projection sequence is incompatible.");
      }
      assertCompletion();
      status = "live";
      replica.markReady(assertCompletion);
      // Readiness listeners can revoke the grant or attachment too.
      assertCompletion();
      projectionSequence = evidence.projectionSequence;
      initialStateFingerprint = undefined;
      initialInitializerDigest = undefined;
      initialSessionBinding = undefined;
      lastRecoveryOutcome = active.outcome;
      recovery = undefined;
      liveRecovery = Object.freeze({ id: active.id, sessionId: active.sessionId, sessionEpoch: active.sessionEpoch,
        assertManagement: active.assertManagement });
      active.resolve(Object.freeze({ outcome: active.outcome, revision: evidence.throughRev }));
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

  function current_recovery(id: string, active: typeof recovery): NonNullable<typeof recovery> | undefined {
    if (active === undefined || active.id !== id || !recoveryCurrent(active)) return undefined;
    return active;
  }

  function install_snapshot(input: AuthorityProjectionSnapshot, active: NonNullable<typeof recovery>, assertEntry: () => void,
    assertManagement: () => void): void {
    const assertAcceptance = () => {
      assertEntry();
      if (!recoveryCurrent(active)) throw new Error("Hosted recovery attachment changed during restoration.");
    };
    const scoped = options.scopedReconciliation === true;
    const snapshot = admit_authority_projection_snapshot(input, true);
    if (active.outcome !== "reconcile" || snapshot.revision !== active.headRev
      || active.projectionDigest !== snapshot.projectionDigest
      || snapshot.authority.logicalMapId !== clientLogicalMapId
      || snapshot.authority.incarnationId !== endpoint.session.incarnationId) {
      throw new Error("Hosted projected snapshot fence is incompatible.");
    }
    const composition = authority_projection_as_client_composition_internal(snapshot, true);
    assertAcceptance();
    if (active.registryDigest !== composition.registryDigest) throw new Error("Hosted projected snapshot registry is incompatible.");
    if (map === undefined) {
      if (composition.registry.libraries.length > 0 || initializers.length > 0) {
        const created = make_livemap_client_composition_from_portable_aggregate_internal(composition, true);
        install_client_local_initializers_internal(created, initializers);
        assertAcceptance();
        replica.attachMap(created);
        map = created;
        observeInstalledPosition(created);
      }
    } else {
      if (replica.clientProjection() === undefined) throw new Error("Hosted projected restore requires a composed client LiveMap.");
      if (scoped) replica.restoreScopedProjection(snapshot, assertAcceptance);
      else replica.restoreHosted(composition, assertAcceptance);
    }
    const assertInstalledCut = () => {
      const installed = replica.clientProjection();
      // Installation may have synchronously accepted further work. Adopt its
      // actual position, then reject this obsolete attempt without undoing it.
      if (installed !== undefined) authorityRev = installed.revision;
      assertManagement();
      if (!recoveryCurrent(active)) throw new Error("Hosted recovery attachment changed during snapshot completion.");
      if (installed !== undefined && (installed.revision !== snapshot.revision
        || installed.authority.logicalMapId !== snapshot.authority.logicalMapId
        || installed.authority.incarnationId !== snapshot.authority.incarnationId
        || installed.registry.digest !== composition.registryDigest)) {
        throw new Error("Hosted recovery advanced beyond its snapshot cut during installation.");
      }
    };
    assertInstalledCut();
    // Private scoped replacement retains the already-verified projection contract.
    if (map !== undefined && !scoped) {
      if (client_projection_identity_internal(map) === undefined) bind_client_projection_identity_internal(map, snapshot, true);
      else replace_client_projection_identity_internal(map, projectionDigest, snapshot, true);
    }
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = composition.registryDigest;
    projectionDigest = snapshot.projectionDigest;
    projectionFeatures = snapshot.systemFeatures;
    if (map === undefined) authorityRev = snapshot.revision;
    if (!scoped) publishAuthorityPosition(assertInstalledCut);
    assertInstalledCut();
  }

  function apply_projection_change(message: import("../locus/locus.aggregate.transport.internal.js").LocusHostedProjectionChange,
    assertAcceptance: () => void, assertInvocation: () => void, recovering = false): void {
    message = own_sync_evidence(message);
    const local = admit_locus_local_initializers(message.local);
    const previousSequence = projectionSequence;
    const assertProjectionPosition = () => {
      assertInvocation();
      if (authorityRev !== message.authorityRev || projectionSequence !== previousSequence
        || projectionDigest !== message.previousDigest) throw new Error("Projection changed during installation publication.");
    };
    assertAcceptance();
    if (authorityRev === undefined || projectionDigest === undefined
      || registryDigest === undefined || incarnationId === undefined
      || message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId
      || !Number.isSafeInteger(message.sequence) || message.sequence < 0
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
      const snapshot = admit_authority_projection_snapshot(message.reconciliation, true);
      const composition = authority_projection_as_client_composition_internal(snapshot, true);
      if (snapshot.authority.logicalMapId !== clientLogicalMapId
        || snapshot.authority.incarnationId !== incarnationId
        || snapshot.revision !== authorityRev || snapshot.projectionDigest !== nextDigest
        || composition.registryDigest !== message.registryDigest
        || JSON.stringify(snapshot.libraries.map(({ root: _root, css: _css, schema: _schema, ...entry }) => { delete entry.quads; delete entry.scopes; return entry; }))
          !== JSON.stringify(message.libraries.map(({ schema: _schema, ...entry }) => entry))
        || JSON.stringify(snapshot.systemFeatures) !== JSON.stringify(message.systemFeatures)
        || JSON.stringify(snapshot.writableDocuments) !== JSON.stringify(message.writableDocuments)) {
        throw new Error("Hosted projection reconciliation fence is incompatible.");
      }
      if (map === undefined) {
        if (composition.registry.libraries.length > 0 || initializers.length > 0) {
          const created = make_livemap_client_composition_from_portable_aggregate_internal(composition, true);
          install_client_local_initializers_internal(created, initializers);
          assertAcceptance();
          replica.attachMap(created);
          map = created;
          observeInstalledPosition(created);
          bind_client_projection_identity_internal(created, snapshot, true);
        }
      } else {
        replica.restoreHosted(composition, assertAcceptance);
        assertProjectionPosition();
        if (replica.clientProjection()?.revision !== message.authorityRev) throw new Error("Projection changed during reconciliation publication.");
        advance_client_projection_identity_internal(map, incarnationId, projectionDigest, nextDigest, message.systemFeatures);
      }
      assertProjectionPosition();
      projectionDigest = nextDigest;
      registryDigest = message.registryDigest;
      projectionFeatures = message.systemFeatures;
      projectionSequence = message.sequence;
      if (map !== undefined) {
        const assertSeedPosition = replica.captureRestorationFence();
        install_client_local_initializers_internal(map, local, () => { assertSeedPosition(); assertInvocation(); });
      }
      assertInvocation();
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
        || next.schemaDigest !== old.schemaDigest || next.rootCodec !== old.rootCodec || next.validation !== old.validation) {
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
          return contract === undefined || entry.name !== contract.name || entry.mode !== contract.mode || entry.validation !== contract.validation
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
        assertAcceptance();
        replica.attachMap(created);
        map = created;
        observeInstalledPosition(created);
        bind_client_projection_identity_internal(created, empty);
      }
      replica.installProjectedTopology(topology, message.registryDigest, message.system, assertAcceptance);
      assertInvocation();
      if (replica.clientProjection()?.registry.digest !== message.registryDigest) {
        throw new Error("Hosted projection topology installation is incomplete.");
      }
    }
    if (map === undefined) throw new Error("Hosted projection change requires a composed client map.");
    assertProjectionPosition();
    advance_client_projection_identity_internal(map, incarnationId, projectionDigest, message.projectionDigest, message.systemFeatures);
    projectionDigest = message.projectionDigest;
    registryDigest = message.registryDigest;
    projectionFeatures = message.systemFeatures;
    projectionSequence = message.sequence;
    const assertSeedPosition = replica.captureRestorationFence();
    install_client_local_initializers_internal(map, local, () => { assertSeedPosition(); assertInvocation(); });
    assertInvocation();
  }

  function apply_live_envelope(envelope: LocusLiveProjectedWireEnvelope,
    assertAcceptance: () => void, assertInvocation: () => void): void {
    envelope = own_sync_evidence(envelope);
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
    assertAcceptance();
    if (admitted.topology !== undefined) {
      if (map === undefined || admitted.previousRegistryDigest !== registryDigest
        || admitted.operations.length !== 0) {
        throw new Error("Projected topology commit is incompatible with this Echo map.");
      }
      replica.installProjectedTopology(admitted.topology, admitted.registryDigest, undefined, assertAcceptance);
      assertInvocation();
      if (replica.clientProjection()?.revision !== admitted.prevRev) throw new Error("Topology advanced during publication.");
      replica.advanceHostedProgress(Object.freeze({ logicalMapId: clientLogicalMapId,
        incarnationId, registryDigest: admitted.registryDigest,
        prevRev: admitted.prevRev, rev: admitted.rev }));
      registryDigest = admitted.registryDigest;
      authorityRev = replica.clientProjection()?.revision ?? admitted.rev;
      assertInvocation();
      publishAuthorityPosition(assertInvocation);
      assertInvocation();
      return;
    }
    const commit = Object.freeze({ ...admitted, registryDigest });
    if (map !== undefined) replica.replayHosted(commit, authorityRev, assertAcceptance);
    // Publication can accept independent newer work. Never restore the older cursor.
    authorityRev = replica.clientProjection()?.revision ?? commit.rev;
    assertInvocation();
    publishAuthorityPosition(assertInvocation);
    assertInvocation();
  }

  function apply_progress(input: import("../locus/locus.aggregate.transport.internal.js").LocusHostedAggregateProgress,
    assertAcceptance: () => void, assertInvocation: () => void): void {
    const progress = Object.freeze({ logicalMapId: input.logicalMapId, incarnationId: input.incarnationId,
      registryDigest: input.registryDigest, prevRev: input.prevRev, rev: input.rev });
    if (incarnationId === undefined || registryDigest === undefined) {
      throw new Error("Hosted authority progress arrived before aggregate bootstrap.");
    }
    const expectedDigest = registryDigest;
    if (progress.logicalMapId !== clientLogicalMapId || progress.incarnationId !== incarnationId
      || progress.registryDigest !== expectedDigest) throw new Error("Hosted authority progress fence is incompatible.");
    if (authorityRev === undefined || progress.prevRev !== authorityRev
      || !Number.isSafeInteger(progress.prevRev) || progress.prevRev < 0
      || !Number.isSafeInteger(progress.rev) || progress.rev !== progress.prevRev + 1) {
      throw new Error("Hosted progress is not contiguous with the Echo authority cursor.");
    }
    assertAcceptance();
    if (map !== undefined) replica.advanceHostedProgress(progress);
    authorityRev = replica.clientProjection()?.revision ?? progress.rev;
    assertInvocation();
    publishAuthorityPosition(assertInvocation);
    assertInvocation();
  }

  function wait_until_ready(): Promise<void> {
    if (endpoint.session.status === "disposed") return Promise.reject(new Error("Hosted aggregate Echo session is disposed."));
    if (status === "live" && recovery === undefined && replica.ready && endpoint.ready) return Promise.resolve();
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

/** Promise callbacks have no synchronous caller to receive notification errors.
 * Use the platform reporting contract without creating another rejected promise. */
function report_recovery_callback_failure(error: unknown): void {
  const reportingGlobal: typeof globalThis & { reportError?: (error: unknown) => void } = globalThis;
  try {
    const report = reportingGlobal.reportError;
    if (typeof report === "function") {
      Reflect.apply(report, globalThis, [error]);
      return;
    }
  } catch (reportingFailure) {
    queueMicrotask(() => { throw reportingFailure; });
    return;
  }
  queueMicrotask(() => { throw error; });
}

/** Own transport evidence without JSON coercion or retaining caller objects.
 * Domain codecs still validate the complete shape and semantic content. */
function own_sync_evidence<T>(input: T): T {
  const ancestors = new Set<object>();
  function copy(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      if (typeof value === "function" || typeof value === "symbol") throw new Error("Invalid synchronization evidence.");
      return value;
    }
    if (ancestors.has(value)) throw new Error("Cyclic synchronization evidence.");
    ancestors.add(value);
    const result = Array.isArray(value) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("Synchronization evidence requires own data fields.");
      }
      Object.defineProperty(result, key, { value: copy(Reflect.get(value, key)), enumerable: true });
    }
    if (Array.isArray(value)) {
      Object.defineProperty(result, "length", { value: Object.getOwnPropertyDescriptor(value, "length")?.value });
    }
    ancestors.delete(value);
    return Object.freeze(result);
  }
  return copy(input) as T;
}
