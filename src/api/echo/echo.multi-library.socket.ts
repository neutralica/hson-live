import { is_Node } from "../../core/node-guards.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapLibraries,
  LivePath,
} from "../../types/livemap.types.js";
import type {
  LocusActionTerminalOutcome,
  LocusClientActionResult,
  LocusDisposer,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoSession,
  EchoSessionOptions,
  LocusSocketLike,
} from "../../types/locus.types.js";
import { decode_locus_server_message } from "../locus/locus.protocol.js";
import { is_locus_json_value } from "../locus/locus.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { node_to_json_value } from "../livemap/livemap.editor.js";
import { decode_exact_hson_value } from "../livemap/livemap.document.view-state-codec.js";
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


type HostedPlanOutcome = "current" | "replay" | "snapshot" | "reject";
type HostedSnapshotReason = "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable";

/** @internal */
export type MultiLibraryEchoSocketClientOptions = Readonly<{
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
  readonly clientId: string;
  readonly session: EchoSession;
  connect: () => Promise<MultiLibraryEchoSocketRecovery>;
  subscribe: (library: string, path: LivePath, listener: (value: JsonValue | undefined, revision: number) => void) => LocusDisposer;
  unsubscribe: (library: string, path: LivePath) => void;
  action: (name: string, payload?: JsonValue) => Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }>;
  retryAction: (request: EchoActionRequest) => Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }>;
  actionStatus: (requestId: string) => Promise<EchoActionStatusResult>;
  wait_until_ready: () => Promise<void>;
  dispose: () => void;
  diagnostics: () => Readonly<{
    status: "idle" | "recovering" | "live" | "failed" | "closed";
    pendingLive: number;
    pendingSync: number;
    subscriptions: readonly Readonly<{ library: string; path: LivePath; revision?: number }>[];
  }>;
}>;

/** @internal Aggregate Echo endpoint over the normal text socket abstraction. */
export function create_multi_library_echo_socket_client_internal(
  options: MultiLibraryEchoSocketClientOptions,
): MultiLibraryEchoSocketClient {
  let generatedId = 0;
  const fresh_id = (prefix: string): string => {
    generatedId += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
  };
  const clientId = options.clientId ?? fresh_id("echo-client");
  const makeActionId = options.actionId ?? (() => fresh_id("action"));
  const makeAttemptId = options.actionAttemptId ?? (() => fresh_id("attempt"));
  const makeStatusId = options.actionStatusId ?? (() => fresh_id("action-status"));
  let map = options.map;
  const mirrorOwner = Object.freeze({});
  let mirrorClaimed = false;
  let logicalMapId = options.logicalMapId;
  let incarnationId: string | undefined;
  let registryDigest: string | undefined;
  let lastAppliedRev: number | undefined;
  if (map !== undefined) {
    const snapshot = internal_livemap_aggregate_authority(map).captureHosted();
    logicalMapId ??= snapshot.authority.logicalMapId;
    incarnationId = snapshot.authority.incarnationId;
    registryDigest = snapshot.registryDigest;
    lastAppliedRev = snapshot.revision;
    internal_livemap_aggregate_authority(map).claimManagement(mirrorOwner);
    mirrorClaimed = true;
  }
  if (logicalMapId === undefined || logicalMapId.length === 0) {
    throw new Error("Hosted aggregate socket Echo requires logicalMapId before bootstrap.");
  }
  const clientLogicalMapId = logicalMapId;
  const subscriptions = new Map<string, Readonly<{
    library: string;
    path: LivePath;
    listener: (value: JsonValue | undefined, revision: number) => void;
    revision?: number;
  }>>();
  const pendingSync = new Map<string, Readonly<{
    library: string;
    path: LivePath;
    revision: number;
    value: JsonValue | undefined;
  }>>();
  let status: "idle" | "recovering" | "live" | "failed" | "closed" = "idle";
  let nextId = 0;
  let recovery: Readonly<{
    id: string;
    resolve: (value: MultiLibraryEchoSocketRecovery) => void;
    reject: (reason: Error) => void;
    outcome?: Exclude<HostedPlanOutcome, "reject">;
    snapshotReceived: boolean;
  }> | undefined;
  const pendingActions = new Map<string, Readonly<{
    resolve: (value: LocusClientActionResult) => void;
    reject: (reason: Error) => void;
  }>>();
  const pendingStatuses = new Map<string, Readonly<{
    requestId: string;
    resolve: (value: EchoActionStatusResult) => void;
    reject: (reason: Error) => void;
  }>>();
  let sessionStatus: "idle" | "creating" | "attaching" | "attached" | "detached" | "failed" | "ended" | "disposed" = "idle";
  let sessionId: string | undefined;
  let sessionCredential = options.session?.credential;
  let sessionEpoch: number | undefined;
  let sessionFailure: Readonly<{ code: string; message: string }> | undefined;
  let sessionCreateCount = 0;
  let sessionReattachCount = 0;
  let sessionFencingCount = 0;
  let sessionRejectionCount = 0;
  let pendingSession: Readonly<{
    id: string;
    kind: "create" | "attach" | "goodbye";
    resolve: (value: Readonly<{ sessionId: string; epoch: number; reattached: boolean }> | undefined) => void;
    reject: (reason: Error) => void;
  }> | undefined;
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();

  const stopMessage = options.socket.onMessage((raw) => {
    try {
      receive(raw);
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error("Hosted aggregate Echo protocol failed."));
    }
  });
  const stopClose = options.socket.onClose(() => {
    if (status !== "closed") fail(new Error("Hosted aggregate socket closed."));
  });

  function next(prefix: string): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
  }

  function send(message: unknown): void {
    if (status === "closed") throw new Error("Hosted aggregate socket Echo is closed.");
    const raw = JSON.stringify(message);
    if (utf8_bytes(raw) > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
      throw new Error("Hosted aggregate Echo message exceeds the live wire byte limit.");
    }
    options.socket.send(raw);
  }

  function fail(error: Error): void {
    if (status === "closed" || status === "failed") return;
    status = "failed";
    const active = recovery;
    recovery = undefined;
    active?.reject(error);
    for (const pending of pendingActions.values()) pending.reject(error);
    pendingActions.clear();
    for (const pending of pendingStatuses.values()) pending.reject(error);
    pendingStatuses.clear();
    pendingSession?.reject(error);
    pendingSession = undefined;
    if (sessionStatus === "attached") sessionStatus = "detached";
    pendingSync.clear();
  }

  function recover_wire(): Promise<MultiLibraryEchoSocketRecovery> {
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate socket Echo is closed."));
    if (recovery !== undefined) return Promise.reject(new Error("Hosted aggregate recovery is already in progress."));
    if (map !== undefined) {
      const snapshot = internal_livemap_aggregate_authority(map).captureHosted();
      incarnationId = snapshot.authority.incarnationId;
      registryDigest = snapshot.registryDigest;
      lastAppliedRev = snapshot.revision;
    }
    status = "recovering";
    pendingSync.clear();
    const id = next("recover");
    return new Promise<MultiLibraryEchoSocketRecovery>((resolve, reject) => {
      recovery = Object.freeze({ id, resolve, reject, snapshotReceived: false });
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
    if (sessionStatus !== "attached") {
      if (sessionCredential === undefined) await create_session();
      else await reattach_session(sessionCredential);
    }
    return recover_wire();
  }

  function receive(raw: string): void {
    const message = decode_server_message(raw);
    if (message.type === "error") {
      if ("ok" in message && message.ok === false && message.id !== undefined && pendingActions.has(message.id)) {
        pendingActions.get(message.id)?.resolve(message);
        pendingActions.delete(message.id);
        return;
      }
      const error = new Error("message" in message ? message.message : message.error.message);
      fail(error);
      return;
    }
    if (message.type === "ack") {
      const pending = pendingActions.get(message.id);
      if (pending === undefined) throw new Error("Hosted aggregate action acknowledgement is unknown.");
      pendingActions.delete(message.id);
      pending.resolve(message);
      return;
    }
    if (message.type === "action-status") {
      const pending = pendingStatuses.get(message.id);
      if (pending === undefined || pending.requestId !== message.requestId) throw new Error("Hosted aggregate action status is unknown.");
      pendingStatuses.delete(message.id);
      pending.resolve(Object.freeze({ requestId: message.requestId, state: message.state, ...(message.outcome === undefined ? {} : { outcome: message.outcome }) }));
      return;
    }
    if (message.type === "session-created" || message.type === "session-attached") {
      const pending = pendingSession;
      if (pending === undefined || pending.id !== message.id) throw new Error("Hosted aggregate session response is unknown.");
      pendingSession = undefined;
      sessionStatus = "attached";
      sessionId = message.sessionId;
      sessionEpoch = message.epoch;
      sessionFailure = undefined;
      if (message.type === "session-created") {
        sessionCredential = message.credential;
        sessionCreateCount += 1;
      } else sessionReattachCount += 1;
      pending.resolve(Object.freeze({ sessionId: message.sessionId, epoch: message.epoch, reattached: message.type === "session-attached" }));
      return;
    }
    if (message.type === "session-rejected") {
      const pending = pendingSession;
      if (pending === undefined || pending.id !== message.id) throw new Error("Hosted aggregate session rejection is unknown.");
      pendingSession = undefined;
      sessionStatus = "failed";
      sessionFailure = Object.freeze({ code: message.code, message: message.message });
      sessionRejectionCount += 1;
      pending.reject(new Error(message.message));
      return;
    }
    if (message.type === "session-fenced") {
      if (sessionId !== message.sessionId || sessionEpoch !== message.epoch) return;
      sessionStatus = "detached";
      sessionFencingCount += 1;
      return;
    }
    if (message.type === "session-ended") {
      const pending = pendingSession;
      if (pending === undefined || pending.id !== message.id) throw new Error("Hosted aggregate session end is unknown.");
      pendingSession = undefined;
      sessionStatus = "ended";
      pending.resolve(undefined);
      return;
    }
    if (message.type === "recovery-plan") {
      const active = require_recovery(message.id);
      if (message.logicalMapId !== clientLogicalMapId) throw new Error("Hosted recovery plan logical map fence is incompatible.");
      if (message.outcome === "reject") throw new Error(message.error.message);
      if (map !== undefined && registryDigest !== undefined && message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery registry mismatch requires a fresh aggregate bootstrap.");
      }
      recovery = Object.freeze({ ...active, outcome: message.outcome });
      return;
    }
    if (message.type === "recovery-snapshot") {
      const active = require_recovery(message.id);
      if (active.outcome !== "snapshot") throw new Error("Hosted recovery received an unexpected aggregate snapshot.");
      install_snapshot(message.snapshot);
      recovery = Object.freeze({ ...active, snapshotReceived: true });
      return;
    }
    if (message.type === "recovery-commit") {
      const active = require_recovery(message.id);
      if (active.outcome !== "replay" && active.outcome !== "snapshot") throw new Error("Hosted recovery received an unexpected aggregate commit.");
      apply_envelope(message.commit);
      return;
    }
    if (message.type === "commit") {
      if (status !== "live" || recovery === undefined && map === undefined) throw new Error("Hosted live commit arrived before aggregate recovery completed.");
      apply_envelope(message.commit);
      return;
    }
    if (message.type === "recovery-caught-up") {
      const active = require_recovery(message.id);
      if (message.logicalMapId !== clientLogicalMapId || message.incarnationId !== incarnationId || message.registryDigest !== registryDigest) {
        throw new Error("Hosted recovery caught-up fence is incompatible with this mirror.");
      }
      if (map === undefined || map.rev !== message.throughRev || lastAppliedRev !== message.throughRev) {
        throw new Error("Hosted recovery caught-up revision does not match the complete Echo replica.");
      }
      status = "live";
      recovery = undefined;
      flush_sync();
      active.resolve(Object.freeze({ outcome: active.outcome ?? "current", revision: message.throughRev }));
      if (sessionStatus === "attached") {
        for (const waiter of [...readyWaiters]) waiter.resolve();
        readyWaiters.clear();
      }
      return;
    }
    if (message.type === "sync") {
      if (message.registryDigest !== registryDigest) throw new Error("Hosted subscription sync registry digest is incompatible.");
      const key = subscription_key(message.library, message.path);
      if (!subscriptions.has(key)) throw new Error("Hosted subscription sync has no matching library-qualified subscription.");
      if (map === undefined || lastAppliedRev === undefined || message.revision > lastAppliedRev) {
        if (status !== "recovering") throw new Error("Hosted subscription sync is ahead of the complete Echo replica.");
        pendingSync.set(key, message);
      } else if (status === "recovering") {
        pendingSync.set(key, message);
      } else {
        publish_sync(key, message);
      }
      return;
    }
    throw new Error("Unknown hosted aggregate socket message.");
  }

  function require_recovery(id: string): NonNullable<typeof recovery> {
    if (recovery === undefined || recovery.id !== id) throw new Error("Hosted recovery message has no active request.");
    return recovery;
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
      internal_livemap_aggregate_authority(map).claimManagement(mirrorOwner);
      mirrorClaimed = true;
    } else {
      // Aggregate recovery validates all roots, Schemas and map-wide QUID state before this
      // single in-place install; retained library handles keep their closure.
      internal_livemap_aggregate_authority(map).restoreHostedManaged(mirrorOwner, snapshot);
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
    const accepted = internal_livemap_aggregate_authority(map).replayHostedManaged(mirrorOwner, commit);
    lastAppliedRev = accepted.rev;
  }

  function flush_sync(): void {
    const items = [...pendingSync.entries()];
    pendingSync.clear();
    for (const [key, message] of items) {
      if (lastAppliedRev === undefined || message.revision > lastAppliedRev) {
        throw new Error("Hosted subscription sync remained ahead after recovery.");
      }
      publish_sync(key, message);
    }
  }

  function publish_sync(
    key: string,
    message: Readonly<{ library: string; path: LivePath; revision: number; value: JsonValue | undefined }>,
  ): void {
    const current = subscriptions.get(key);
    if (current === undefined) return;
    if (current.revision !== undefined && message.revision < current.revision) return;
    const library = map?.lib(message.library);
    if (library === undefined || !("snap" in library)) throw new Error("Hosted sync Library is not an active data Library.");
    const local = library.snap(message.path);
    if (!same_json(local, message.value)) throw new Error("Hosted subscription sync does not match the complete Echo replica.");
    subscriptions.set(key, Object.freeze({ ...current, revision: message.revision }));
    current.listener(message.value, message.revision);
  }

  function subscribe(library: string, path: LivePath, listener: (value: JsonValue | undefined, revision: number) => void): LocusDisposer {
    if (map === undefined || registryDigest === undefined || status !== "live") {
      throw new Error("Hosted subscriptions require a live aggregate mirror.");
    }
    let selected;
    try {
      selected = map.lib(library);
    } catch {
      throw new Error(`Unknown hosted Library ${JSON.stringify(library)}.`);
    }
    if (!("snap" in selected)) {
      throw new Error("Hosted document library subscriptions are not implemented for multi-library Locus.");
    }
    const stablePath = clone_path(path);
    const key = subscription_key(library, stablePath);
    if (subscriptions.has(key)) throw new Error("Hosted library-qualified subscription already exists.");
    subscriptions.set(key, Object.freeze({ library, path: stablePath, listener }));
    send(Object.freeze({ type: "subscribe", library, path: stablePath, registryDigest }));
    return () => unsubscribe(library, stablePath);
  }

  function unsubscribe(library: string, path: LivePath): void {
    if (registryDigest === undefined) return;
    const stablePath = clone_path(path);
    const key = subscription_key(library, stablePath);
    if (!subscriptions.delete(key)) return;
    send(Object.freeze({ type: "unsubscribe", library, path: stablePath, registryDigest }));
  }

  function session_request(
    kind: "create" | "attach" | "goodbye",
    credential?: string,
  ): Promise<Readonly<{ sessionId: string; epoch: number; reattached: boolean }> | undefined> {
    if (pendingSession !== undefined) return Promise.reject(new Error("Hosted aggregate session request is already pending."));
    const id = next(`session-${kind}`);
    if (kind === "create") sessionStatus = "creating";
    else if (kind === "attach") sessionStatus = "attaching";
    return new Promise((resolve, reject) => {
      pendingSession = Object.freeze({ id, kind, resolve, reject });
      try {
        send(Object.freeze({
          type: kind === "create" ? "session-create" : kind === "attach" ? "session-attach" : "session-goodbye",
          id,
          ...(kind === "attach" && credential !== undefined ? { credential } : {}),
        }));
      } catch (cause) {
        pendingSession = undefined;
        reject(cause);
      }
    });
  }

  async function create_session(): Promise<Readonly<{ sessionId: string; epoch: number; reattached: boolean }>> {
    const result = await session_request("create");
    if (result === undefined) throw new Error("Hosted aggregate session creation did not return a session.");
    return result;
  }

  async function reattach_session(credential = sessionCredential): Promise<Readonly<{ sessionId: string; epoch: number; reattached: boolean }>> {
    const result = await session_request("attach", credential);
    if (result === undefined) throw new Error("Hosted aggregate session attachment did not return a session.");
    return result;
  }

  async function goodbye_session(): Promise<void> {
    await session_request("goodbye");
  }

  function action_handle(request: EchoActionRequest, retry: boolean): Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }> {
    const attemptId = makeAttemptId();
    const promise = new Promise<LocusClientActionResult>((resolve, reject) => {
      if (sessionStatus !== "attached") {
        reject(new Error("Hosted aggregate Echo is disconnected."));
        return;
      }
      pendingActions.set(attemptId, Object.freeze({ resolve, reject }));
      try {
        send(Object.freeze({
          type: "action",
          id: attemptId,
          requestId: request.requestId,
          attemptId,
          clientId,
          name: request.name,
          ...(request.payload === undefined ? {} : { payload: request.payload }),
          ...(retry ? { retry: true as const } : {}),
        }));
      } catch (cause) {
        pendingActions.delete(attemptId);
        reject(cause);
      }
    });
    return Object.assign(promise, { request });
  }

  function action(name: string, payload?: JsonValue): Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }> {
    const request = Object.freeze({ requestId: makeActionId(), name, ...(payload === undefined ? {} : { payload }) });
    if (payload !== undefined && !is_locus_json_value(payload)) {
      return Object.assign(Promise.reject(new Error("Hosted action payload must be JSON-serializable.")), { request });
    }
    return action_handle(request, false);
  }

  function retryAction(request: EchoActionRequest): Promise<LocusClientActionResult> & Readonly<{ request: EchoActionRequest }> {
    const stable = Object.freeze({ requestId: request.requestId, name: request.name, ...(request.payload === undefined ? {} : { payload: request.payload }) });
    return action_handle(stable, true);
  }

  function actionStatus(requestId: string): Promise<EchoActionStatusResult> {
    const id = makeStatusId();
    return new Promise((resolve, reject) => {
      if (sessionStatus !== "attached") {
        reject(new Error("Hosted aggregate Echo is disconnected."));
        return;
      }
      pendingStatuses.set(id, Object.freeze({ requestId, resolve, reject }));
      try { send(Object.freeze({ type: "action-status", id, clientId, requestId })); }
      catch (cause) { pendingStatuses.delete(id); reject(cause); }
    });
  }

  function wait_until_ready(): Promise<void> {
    if (status === "live" && sessionStatus === "attached") return Promise.resolve();
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate socket Echo is closed."));
    return new Promise((resolve, reject) => { readyWaiters.add(Object.freeze({ resolve, reject })); });
  }

  const session: EchoSession = Object.freeze({
    get status() { return sessionStatus; },
    get sessionId() { return sessionId; },
    get credential() { return sessionCredential; },
    get epoch() { return sessionEpoch; },
    get failure() { return sessionFailure; },
    create: create_session,
    reattach: reattach_session,
    goodbye: goodbye_session,
    dispose: () => { sessionStatus = "disposed"; },
    debug: () => Object.freeze({
      status: sessionStatus,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(sessionEpoch === undefined ? {} : { epoch: sessionEpoch }),
      hasCredential: sessionCredential !== undefined,
      createCount: sessionCreateCount,
      reattachCount: sessionReattachCount,
      fencingCount: sessionFencingCount,
      rejectionCount: sessionRejectionCount,
    }),
  });

  return Object.freeze({
    get map() { return map; },
    logicalMapId: clientLogicalMapId,
    get incarnationId() { return incarnationId; },
    get registryDigest() { return registryDigest; },
    get lastAppliedRev() { return lastAppliedRev; },
    clientId,
    session,
    connect: connect_client,
    subscribe,
    unsubscribe,
    action,
    retryAction,
    actionStatus,
    wait_until_ready,
    dispose: () => {
      if (status === "closed") return;
      status = "closed";
      stopMessage?.();
      stopClose?.();
      const error = new Error("Hosted aggregate socket Echo is closed.");
      recovery?.reject(error);
      recovery = undefined;
      for (const pending of pendingActions.values()) pending.reject(error);
      pendingActions.clear();
      for (const pending of pendingStatuses.values()) pending.reject(error);
      pendingStatuses.clear();
      pendingSession?.reject(error);
      pendingSession = undefined;
      for (const waiter of readyWaiters) waiter.reject(error);
      readyWaiters.clear();
      sessionStatus = "disposed";
      pendingSync.clear();
      subscriptions.clear();
      if (map !== undefined && mirrorClaimed) {
        internal_livemap_aggregate_authority(map).releaseManagement(mirrorOwner);
        mirrorClaimed = false;
      }
    },
    diagnostics: () => Object.freeze({
      status,
      pendingLive: 0,
      pendingSync: pendingSync.size,
      subscriptions: Object.freeze([...subscriptions.values()].map((subscription) => Object.freeze({
        library: subscription.library,
        path: clone_path(subscription.path),
        ...(subscription.revision === undefined ? {} : { revision: subscription.revision }),
      }))),
    }),
  });
}

type DecodedServerMessage =
  | Readonly<{ type: "error"; id?: string; message: string }>
  | LocusClientActionResult
  | Readonly<{ type: "action-status"; id: string; requestId: string; state: "pending" | "succeeded" | "failed" | "unknown" | "expired"; outcome?: LocusActionTerminalOutcome }>
  | Readonly<{ type: "session-created"; id: string; sessionId: string; credential: string; epoch: number }>
  | Readonly<{ type: "session-attached"; id: string; sessionId: string; epoch: number }>
  | Readonly<{ type: "session-rejected"; id: string; code: string; message: string }>
  | Readonly<{ type: "session-fenced"; sessionId: string; epoch: number; code: "LOCUS_SESSION_ATTACHMENT_FENCED" }>
  | Readonly<{ type: "session-ended"; id: string; sessionId: string; epoch: number }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: Exclude<HostedPlanOutcome, "reject">; reason?: HostedSnapshotReason }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: "reject"; error: Readonly<{ message: string }> }>
  | Readonly<{ type: "recovery-snapshot"; id: string; snapshot: HostedAggregateSnapshot }>
  | Readonly<{ type: "recovery-commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "recovery-caught-up"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; throughRev: number }>
  | Readonly<{ type: "sync"; registryDigest: string; revision: number; library: string; path: LivePath; value: JsonValue | undefined }>;

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
  if (value.type === "sync") {
    exact_keys(value, ["type", "format", "registryDigest", "revision", "library", "path", "present", "payload"], "Hosted subscription sync");
    const registryDigest = required_digest(value.registryDigest);
    const revision = required_revision(value.revision);
    const library = required_string(value.library);
    if (registryDigest === undefined || revision === undefined || library === undefined || !is_live_path(value.path) || typeof value.present !== "boolean" || typeof value.payload !== "string") throw new Error("Hosted subscription sync is malformed.");
    let decoded: JsonValue | undefined;
    if (value.present) {
      const exact = decode_exact_hson_value(value.payload);
      decoded = is_Node(exact) ? node_to_json_value(exact) : exact;
    } else if (value.payload !== "") {
      throw new Error("Hosted absent subscription sync must not carry a payload.");
    }
    return Object.freeze({ type: "sync", registryDigest, revision, library, path: clone_path(value.path), value: decoded });
  }
  throw new Error("Hosted aggregate server message type is unknown.");
}

function same_json(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => same_json(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && same_json(left[key], right[key]));
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

function is_live_path(value: unknown): value is LivePath {
  return Array.isArray(value) && value.every((part) => typeof part === "string"
    || (typeof part === "number" && Number.isSafeInteger(part) && part >= 0));
}

function clone_path(path: LivePath): LivePath {
  return Object.freeze([...path]);
}

function subscription_key(library: string, path: LivePath): string {
  return `${library}\u0000${JSON.stringify(path)}`;
}

function is_snapshot_reason(value: unknown): value is HostedSnapshotReason {
  return value === "no_usable_revision" || value === "incarnation_mismatch" || value === "registry_mismatch" || value === "history_unavailable";
}
