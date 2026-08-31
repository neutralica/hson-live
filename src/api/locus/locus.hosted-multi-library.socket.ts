import { is_Node } from "../../core/node-guards.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentTarget,
  LiveMapLibraries,
  LivePath,
} from "../../types/livemap.types.js";
import type { LocusDisposer, LocusSocketLike } from "../../types/locus.types.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import { decode_locus_graph_content } from "./locus.graph-content-codec.js";
import {
  decode_locus_document_attribute_name,
  decode_locus_document_attribute_value,
  decode_locus_document_attrs,
  decode_locus_document_target,
  is_locus_json_value,
} from "./locus.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { node_to_json_value } from "../livemap/livemap.editor.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
} from "../livemap/livemap.document.view-state-codec.js";
import {
  HOSTED_MAX_SNAPSHOT_BYTES,
  assert_hosted_snapshot_bound,
  assert_hosted_snapshot_shape,
  type HostedAggregateSnapshot,
} from "../livemap/livemap.hosted.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
  create_locus_hosted_aggregate_internal,
  decode_locus_hosted_aggregate_envelope,
  type LocusHostedAggregate,
  type LocusHostedAggregateAction,
  type LocusHostedAggregateDataDraft,
  type LocusHostedAggregateDocumentDraft,
  type LocusHostedAggregateDraft,
  type LocusHostedAggregateGateInput,
  type LocusHostedAggregateWireEnvelope,
} from "./locus.hosted-multi-library.js";

/** Internal aggregate socket protocol discriminator. It never alters commit evidence. */
export const LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT = "hson-locus-hosted-aggregate-h3" as const;
/** The established Locus retained live-history budget. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES = 4 * 1_024 * 1_024;

type HostedCursor = Readonly<{
  incarnationId: string;
  registryDigest: string;
  lastAppliedRev: number;
}>;

type HostedSubscription = Readonly<{
  library: string;
  path: LivePath;
}>;

type HostedRequest =
  | Readonly<{ type: "recover"; id: string; logicalMapId: string; cursor?: HostedCursor }>
  | Readonly<{ type: "subscribe"; library: string; path: LivePath; registryDigest: string }>
  | Readonly<{ type: "unsubscribe"; library: string; path: LivePath; registryDigest: string }>
  | Readonly<{ type: "action"; id: string; name: string; payload?: JsonValue }>;

type HostedPlanOutcome = "current" | "replay" | "snapshot" | "reject";
type HostedSnapshotReason = "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable";

type HostedHistoryEntry = Readonly<{
  envelope: LocusHostedAggregateWireEnvelope;
  bytes: number;
}>;

type HostedConnection = {
  readonly socket: LocusSocketLike;
  readonly subscriptions: Map<string, HostedSubscription>;
  recoveryId: string | undefined;
  recovering: boolean;
  live: boolean;
  readonly pendingLive: LocusHostedAggregateWireEnvelope[];
  closed: boolean;
  stopMessage?: LocusDisposer;
  stopClose?: LocusDisposer;
};

export type LocusHostedAggregateSocketOptions = Readonly<{
  map: LiveMapLibraries;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  maxWireBytes?: number;
  maxHistoryBytes?: number;
  /** Internal deterministic interleave seam for pending-live proof coverage. */
  internal?: Readonly<{
    afterRecoveryCut?: () => void | Promise<void>;
  }>;
}>;

export type LocusHostedAggregateSocketServer = Readonly<{
  map: LiveMapLibraries;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  connect: (socket: LocusSocketLike) => LocusDisposer;
  mutate: LocusHostedAggregate["mutate"];
  dispatch_action: LocusHostedAggregate["dispatch_action"];
  /** Ordered internal barrier used by persistence checkpointing. */
  run_exclusive: LocusHostedAggregate["run_exclusive"];
  debug: () => Readonly<{
    historyBaseRevision: number;
    retainedHistoryBytes: number;
    retainedCommits: number;
    connections: number;
    subscriptions: readonly Readonly<{ library: string; path: LivePath }>[];
    effectiveLiveWireBytes: number;
    effectiveSnapshotWireBytes: number;
  }>;
  dispose: () => void;
}>;

export type LocusHostedAggregateSocketClientOptions = Readonly<{
  socket: LocusSocketLike;
  /** Required for an unbootstrapped client; an existing mirror supplies it. */
  logicalMapId?: string;
  /** An existing aggregate mirror is restored in place during snapshot recovery. */
  map?: LiveMapLibraries;
}>;

export type LocusHostedAggregateSocketRecovery = Readonly<{
  outcome: Exclude<HostedPlanOutcome, "reject">;
  revision: number;
}>;

export type LocusHostedAggregateSocketClient = Readonly<{
  /** Undefined until an aggregate bootstrap snapshot has passed every validation check. */
  readonly map: LiveMapLibraries | undefined;
  readonly logicalMapId: string;
  readonly incarnationId: string | undefined;
  readonly registryDigest: string | undefined;
  readonly lastAppliedRev: number | undefined;
  connect: () => Promise<LocusHostedAggregateSocketRecovery>;
  recover: () => Promise<LocusHostedAggregateSocketRecovery>;
  subscribe: (library: string, path: LivePath, listener: (value: JsonValue | undefined, revision: number) => void) => LocusDisposer;
  unsubscribe: (library: string, path: LivePath) => void;
  action: (name: string, payload?: JsonValue) => Promise<JsonValue | undefined>;
  close: () => void;
  diagnostics: () => Readonly<{
    status: "idle" | "recovering" | "live" | "failed" | "closed";
    pendingLive: number;
    pendingSync: number;
    subscriptions: readonly Readonly<{ library: string; path: LivePath; revision?: number }>[];
  }>;
}>;

/**
 * Aggregate transport authority. It deliberately owns one aggregate
 * Locus, one global retained history and one map-wide recovery cut; it does
 * not route a library through the legacy solo Locus representation.
 */
export function create_locus_hosted_aggregate_socket_internal(
  options: LocusHostedAggregateSocketOptions,
): LocusHostedAggregateSocketServer {
  const maxWireBytes = bounded(
    options.maxWireBytes,
    DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
    "live wire",
    DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  );
  const maxHistoryBytes = bounded(options.maxHistoryBytes, DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES, "history", HOSTED_MAX_SNAPSHOT_BYTES);
  const aggregate = internal_livemap_aggregate_authority(options.map);
  const initial = aggregate.captureHosted();
  const registry = aggregate.hostedRegistry();
  const bindings = aggregate.libraries();
  const identitiesByName = new Map<string, object>();
  for (let index = 0; index < registry.libraries.length; index += 1) {
    const entry = registry.libraries[index];
    const identity = bindings[index];
    if (entry === undefined || identity === undefined) throw new Error("Hosted aggregate registry identity binding is unavailable.");
    identitiesByName.set(entry.name, identity);
  }

  let disposed = false;
  let historyBaseRevision = initial.revision;
  let retainedBytes = 0;
  const history: HostedHistoryEntry[] = [];
  const connections = new Set<HostedConnection>();
  const locus = create_locus_hosted_aggregate_internal({
    map: options.map,
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    maxWireBytes,
  });

  const stopWire = locus.on_wire((wire) => {
    if (disposed) return;
    const envelope = aggregate_envelope_from_wire(wire, locus);
    append_history(envelope);
    for (const connection of [...connections]) {
      if (connection.closed) continue;
      if (connection.recovering) connection.pendingLive.push(envelope);
      else if (connection.live && connection.recoveryId !== undefined) {
        send_live_commit(connection, connection.recoveryId, envelope);
      }
    }
    // This preserves the existing sync_all model: subscriptions do not filter
    // canonical commits, and are merely value-oriented notifications.
    for (const connection of [...connections]) {
      if (connection.live && !connection.recovering && !connection.closed) sync_all(connection);
    }
  });

  function append_history(envelope: LocusHostedAggregateWireEnvelope): void {
    const commit = envelope.commit;
    const previous = history.length === 0 ? historyBaseRevision : history[history.length - 1]?.envelope.commit.rev;
    if (previous !== commit.prevRev) {
      throw new Error("Hosted aggregate history lost global revision continuity.");
    }
    const bytes = encoded_bytes(envelope);
    if (bytes > maxHistoryBytes) {
      history.length = 0;
      retainedBytes = 0;
      historyBaseRevision = commit.rev;
      return;
    }
    history.push(Object.freeze({ envelope, bytes }));
    retainedBytes += bytes;
    while (retainedBytes > maxHistoryBytes) {
      const removed = history.shift();
      if (removed === undefined) break;
      retainedBytes -= removed.bytes;
      historyBaseRevision = removed.envelope.commit.rev;
    }
  }

  function send(connection: HostedConnection, message: unknown, limit = maxWireBytes): void {
    if (connection.closed) return;
    const raw = JSON.stringify(message);
    if (utf8_bytes(raw) > limit) throw new Error("Hosted aggregate socket message exceeds its configured byte limit.");
    connection.socket.send(raw);
  }

  function reject(connection: HostedConnection, code: string, message: string, id?: string): void {
    send(connection, Object.freeze({
      type: "error",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(id === undefined ? {} : { id }),
      code,
      message,
    }));
  }

  function send_live_commit(connection: HostedConnection, id: string, envelope: LocusHostedAggregateWireEnvelope): void {
    send(connection, Object.freeze({
      type: "commit",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id,
      commit: envelope,
    }));
  }

  function send_sync(connection: HostedConnection, subscription: HostedSubscription): void {
    const identity = identitiesByName.get(subscription.library);
    if (identity === undefined) return;
    const value = aggregate.snap(identity, subscription.path);
    const encoded = exact_sync_value(value);
    send(connection, Object.freeze({
      type: "sync",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      registryDigest: registry.digest,
      revision: locus.rev,
      library: subscription.library,
      path: clone_path(subscription.path),
      ...encoded,
    }));
  }

  function sync_all(connection: HostedConnection): void {
    for (const subscription of connection.subscriptions.values()) send_sync(connection, subscription);
  }

  async function recover(connection: HostedConnection, request: Extract<HostedRequest, { type: "recover" }>): Promise<void> {
    if (request.logicalMapId !== locus.logicalMapId) {
      send(connection, recovery_plan(request.id, "reject", locus.rev, {
        code: "LOCUS_RECOVERY_INVALID_TARGET",
        message: `Unknown hosted logical map ID: ${request.logicalMapId}`,
      }));
      return;
    }
    const cursor = request.cursor;
    const sameIncarnation = cursor?.incarnationId === locus.incarnationId;
    const sameRegistry = cursor?.registryDigest === registry.digest;
    if (cursor !== undefined && cursor.lastAppliedRev > locus.rev && sameIncarnation && sameRegistry) {
      send(connection, recovery_plan(request.id, "reject", locus.rev, {
        code: "REVISION_AHEAD_OF_AUTHORITY",
        message: `Client revision ${cursor.lastAppliedRev} is ahead of authoritative revision ${locus.rev}.`,
      }));
      return;
    }
    if (connection.recovering) {
      reject(connection, "LOCUS_RECOVERY_IN_PROGRESS", "Hosted aggregate recovery is already in progress.", request.id);
      return;
    }

    connection.recoveryId = request.id;
    connection.recovering = true;
    connection.live = false;
    connection.pendingLive.length = 0;
    let outcome: Exclude<HostedPlanOutcome, "reject">;
    let reason: HostedSnapshotReason | undefined;
    let snapshot: HostedAggregateSnapshot | undefined;
    let replay: readonly HostedHistoryEntry[] = Object.freeze([]);
    const head = locus.rev;
    if (cursor === undefined) {
      outcome = "snapshot";
      reason = "no_usable_revision";
    } else if (!sameRegistry) {
      outcome = "snapshot";
      reason = "registry_mismatch";
    } else if (!sameIncarnation) {
      outcome = "snapshot";
      reason = "incarnation_mismatch";
    } else if (cursor.lastAppliedRev === head) {
      outcome = "current";
    } else {
      const retained = replay_after(cursor.lastAppliedRev, head);
      if (retained === undefined) {
        outcome = "snapshot";
        reason = "history_unavailable";
      } else {
        outcome = "replay";
        replay = retained;
      }
    }

    if (outcome === "snapshot") {
      snapshot = aggregate.captureHosted();
      if (snapshot.revision !== locus.rev) throw new Error("Hosted aggregate snapshot cut disagrees with its global revision.");
    }
    const cut = snapshot?.revision ?? head;
    await options.internal?.afterRecoveryCut?.();
    send(connection, recovery_plan(request.id, outcome, cut, reason === undefined ? undefined : { reason }));
    if (snapshot !== undefined) {
      send(connection, Object.freeze({
        type: "recovery-snapshot",
        format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
        id: request.id,
        snapshot,
      }), HOSTED_MAX_SNAPSHOT_BYTES);
    } else {
      for (const entry of replay) {
        send(connection, Object.freeze({
          type: "recovery-commit",
          format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
          id: request.id,
          phase: "body",
          commit: entry.envelope,
        }));
      }
    }
    send(connection, Object.freeze({
      type: "recovery-caught-up",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id: request.id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: registry.digest,
      throughRev: cut,
    }));
    connection.recovering = false;
    connection.live = true;
    while (connection.pendingLive.length > 0) {
      const pending = connection.pendingLive.shift();
      if (pending === undefined) continue;
      if (pending.commit.prevRev < cut) continue;
      send_live_commit(connection, request.id, pending);
    }
    // Recover the complete mirror first; values are synchronized only after
    // the global stream has crossed its recovery boundary.
    sync_all(connection);
  }

  function replay_after(revision: number, head: number): readonly HostedHistoryEntry[] | undefined {
    if (revision < historyBaseRevision) return undefined;
    if (revision === head) return Object.freeze([]);
    const result = history.filter((entry) => entry.envelope.commit.rev > revision && entry.envelope.commit.rev <= head);
    if (result.length === 0 || result[0]?.envelope.commit.prevRev !== revision || result[result.length - 1]?.envelope.commit.rev !== head) {
      return undefined;
    }
    for (let index = 1; index < result.length; index += 1) {
      if (result[index]?.envelope.commit.prevRev !== result[index - 1]?.envelope.commit.rev) return undefined;
    }
    return Object.freeze([...result]);
  }

  function recovery_plan(
    id: string,
    outcome: HostedPlanOutcome,
    headRev: number,
    detail?: Readonly<{ reason: HostedSnapshotReason }> | Readonly<{ code: string; message: string }>,
  ): object {
    const base = {
      type: "recovery-plan" as const,
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: registry.digest,
      headRev,
      outcome,
    };
    if (outcome === "snapshot") return Object.freeze({ ...base, reason: (detail as { reason: HostedSnapshotReason }).reason });
    if (outcome === "reject") return Object.freeze({ ...base, error: detail });
    return Object.freeze(base);
  }

  async function action(connection: HostedConnection, request: Extract<HostedRequest, { type: "action" }>): Promise<void> {
    try {
      let result: JsonValue | void;
      if (is_document_action(request.name)) {
        await locus.mutate((draft) => apply_document_action(draft, aggregate, identitiesByName, request.name, request.payload));
        result = undefined;
      } else {
        result = await locus.dispatch_action(request.name, request.payload);
      }
      send(connection, Object.freeze({
        type: "ack",
        format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
        id: request.id,
        revision: locus.rev,
        ...(result === undefined ? {} : { result }),
      }));
    } catch (cause) {
      reject(connection, "LOCUS_ACTION_FAILED", cause instanceof Error ? cause.message : "Hosted aggregate action failed.", request.id);
    }
  }

  function subscribe(connection: HostedConnection, request: Extract<HostedRequest, { type: "subscribe" | "unsubscribe" }>): void {
    if (!connection.live || connection.recovering) {
      reject(connection, "LOCUS_RECOVERY_REQUIRED", "Hosted subscriptions require a caught-up aggregate mirror.");
      return;
    }
    if (request.registryDigest !== registry.digest) {
      reject(connection, "LOCUS_REGISTRY_MISMATCH", "Hosted subscription registry digest is incompatible.");
      return;
    }
    const entry = registry.libraries.find((candidate) => candidate.name === request.library);
    const identity = identitiesByName.get(request.library);
    if (entry === undefined || identity === undefined) {
      reject(connection, "LOCUS_UNKNOWN_LIBRARY", `Unknown hosted Library ${JSON.stringify(request.library)}.`);
      return;
    }
    if (entry.mode === "document") {
      reject(connection, "LOCUS_PROJECTED_SUBSCRIPTION_UNSUPPORTED", "Document library subscriptions are not implemented for hosted multi-library Locus.");
      return;
    }
    const subscription = Object.freeze({ library: request.library, path: clone_path(request.path) });
    const key = subscription_key(subscription.library, subscription.path);
    if (request.type === "subscribe") {
      if (connection.subscriptions.has(key)) {
        reject(connection, "LOCUS_DUPLICATE_SUBSCRIPTION", "Hosted subscription already exists.");
        return;
      }
      connection.subscriptions.set(key, subscription);
      send_sync(connection, subscription);
      return;
    }
    if (!connection.subscriptions.delete(key)) {
      reject(connection, "LOCUS_UNKNOWN_SUBSCRIPTION", "Hosted subscription does not exist.");
    }
  }

  function connect(socket: LocusSocketLike): LocusDisposer {
    if (disposed) return () => {};
    const connection: HostedConnection = {
      socket,
      subscriptions: new Map(),
      recoveryId: undefined,
      recovering: false,
      live: false,
      pendingLive: [],
      closed: false,
    };
    connections.add(connection);
    const close = (): void => {
      if (connection.closed) return;
      connection.closed = true;
      connection.pendingLive.length = 0;
      connection.subscriptions.clear();
      connection.stopMessage?.();
      connection.stopClose?.();
      connections.delete(connection);
    };
    connection.stopMessage = socket.onMessage((raw) => {
      let request: HostedRequest;
      try {
        request = decode_request(raw, maxWireBytes);
      } catch (cause) {
        reject(connection, "LOCUS_PROTOCOL_INVALID", cause instanceof Error ? cause.message : "Malformed hosted protocol message.");
        return;
      }
      if (request.type === "recover") {
        void recover(connection, request).catch((cause: unknown) => {
          connection.recovering = false;
          reject(connection, "LOCUS_RECOVERY_FAILED", cause instanceof Error ? cause.message : "Hosted aggregate recovery failed.", request.id);
        });
      }
      else if (request.type === "subscribe" || request.type === "unsubscribe") subscribe(connection, request);
      else void action(connection, request);
    }) ?? undefined;
    connection.stopClose = socket.onClose(close) ?? undefined;
    return close;
  }

  return Object.freeze({
    map: options.map,
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    registryDigest: registry.digest,
    get rev() { return locus.rev; },
    connect,
    mutate: locus.mutate,
    dispatch_action: locus.dispatch_action,
    run_exclusive: locus.run_exclusive,
    debug: () => Object.freeze({
      historyBaseRevision,
      retainedHistoryBytes: retainedBytes,
      retainedCommits: history.length,
      connections: connections.size,
      subscriptions: Object.freeze([...connections].flatMap((connection) =>
        [...connection.subscriptions.values()].map((subscription) => Object.freeze({
          library: subscription.library,
          path: clone_path(subscription.path),
        })))),
      effectiveLiveWireBytes: maxWireBytes,
      effectiveSnapshotWireBytes: HOSTED_MAX_SNAPSHOT_BYTES,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopWire();
      for (const connection of [...connections]) {
        connection.closed = true;
        connection.stopMessage?.();
        connection.stopClose?.();
      }
      connections.clear();
      locus.dispose();
    },
  });
}

/** Internal aggregate client over the normal text socket abstraction. */
export function create_locus_hosted_aggregate_socket_client_internal(
  options: LocusHostedAggregateSocketClientOptions,
): LocusHostedAggregateSocketClient {
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
    throw new Error("Hosted aggregate socket client requires logicalMapId before bootstrap.");
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
    resolve: (value: LocusHostedAggregateSocketRecovery) => void;
    reject: (reason: Error) => void;
    outcome?: Exclude<HostedPlanOutcome, "reject">;
    snapshotReceived: boolean;
  }> | undefined;
  const pendingActions = new Map<string, Readonly<{
    resolve: (value: JsonValue | undefined) => void;
    reject: (reason: Error) => void;
  }>>();

  const stopMessage = options.socket.onMessage((raw) => {
    try {
      receive(raw);
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error("Hosted aggregate client protocol failed."));
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
    if (status === "closed") throw new Error("Hosted aggregate socket client is closed.");
    const raw = JSON.stringify(message);
    if (utf8_bytes(raw) > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
      throw new Error("Hosted aggregate client message exceeds the live wire byte limit.");
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
    pendingSync.clear();
  }

  function recover(): Promise<LocusHostedAggregateSocketRecovery> {
    if (status === "closed") return Promise.reject(new Error("Hosted aggregate socket client is closed."));
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
    return new Promise<LocusHostedAggregateSocketRecovery>((resolve, reject) => {
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

  function receive(raw: string): void {
    const message = decode_server_message(raw);
    if (message.type === "error") {
      const error = new Error(message.message);
      if (message.id !== undefined && pendingActions.has(message.id)) {
        pendingActions.get(message.id)?.reject(error);
        pendingActions.delete(message.id);
        return;
      }
      fail(error);
      return;
    }
    if (message.type === "ack") {
      const pending = pendingActions.get(message.id);
      if (pending === undefined) throw new Error("Hosted aggregate action acknowledgement is unknown.");
      pendingActions.delete(message.id);
      pending.resolve(message.result);
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
        throw new Error("Hosted recovery caught-up revision does not match the complete client mirror.");
      }
      status = "live";
      recovery = undefined;
      flush_sync();
      active.resolve(Object.freeze({ outcome: active.outcome ?? "current", revision: message.throughRev }));
      return;
    }
    if (message.type === "sync") {
      if (message.registryDigest !== registryDigest) throw new Error("Hosted subscription sync registry digest is incompatible.");
      const key = subscription_key(message.library, message.path);
      if (!subscriptions.has(key)) throw new Error("Hosted subscription sync has no matching library-qualified subscription.");
      if (map === undefined || lastAppliedRev === undefined || message.revision > lastAppliedRev) {
        if (status !== "recovering") throw new Error("Hosted subscription sync is ahead of the complete client mirror.");
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
    if (!same_json(local, message.value)) throw new Error("Hosted subscription sync does not match the complete client mirror.");
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

  function action(name: string, payload?: JsonValue): Promise<JsonValue | undefined> {
    if (payload !== undefined && !is_locus_json_value(payload)) return Promise.reject(new Error("Hosted action payload must be JSON-serializable."));
    const id = next("action");
    return new Promise<JsonValue | undefined>((resolve, reject) => {
      pendingActions.set(id, Object.freeze({ resolve, reject }));
      try {
        send(Object.freeze({ type: "action", id, name, ...(payload === undefined ? {} : { payload }) }));
      } catch (cause) {
        pendingActions.delete(id);
        reject(cause);
      }
    });
  }

  return Object.freeze({
    get map() { return map; },
    logicalMapId: clientLogicalMapId,
    get incarnationId() { return incarnationId; },
    get registryDigest() { return registryDigest; },
    get lastAppliedRev() { return lastAppliedRev; },
    connect: recover,
    recover,
    subscribe,
    unsubscribe,
    action,
    close: () => {
      if (status === "closed") return;
      status = "closed";
      stopMessage?.();
      stopClose?.();
      const error = new Error("Hosted aggregate socket client is closed.");
      recovery?.reject(error);
      recovery = undefined;
      for (const pending of pendingActions.values()) pending.reject(error);
      pendingActions.clear();
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

function aggregate_envelope_from_wire(wire: string, locus: LocusHostedAggregate): LocusHostedAggregateWireEnvelope {
  const parsed = JSON.parse(wire) as unknown;
  const message = exact_record(parsed, "Hosted aggregate wire");
  exact_keys(message, ["type", "id", "commit"], "Hosted aggregate wire");
  if (message.type !== "commit" || message.id !== "hosted-aggregate") throw new Error("Hosted aggregate wire routing is invalid.");
  const envelope = message.commit as LocusHostedAggregateWireEnvelope;
  decode_locus_hosted_aggregate_envelope(envelope, Object.freeze({
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    registryDigest: locus.registryDigest,
    maxWireBytes: DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  }));
  return envelope;
}

function decode_request(raw: string, maxWireBytes: number): HostedRequest {
  if (typeof raw !== "string" || utf8_bytes(raw) > maxWireBytes) throw new Error("Hosted aggregate request is malformed or exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate request");
  if (value.type === "recover") {
    const hasCursor = Object.hasOwn(value, "incarnationId") || Object.hasOwn(value, "registryDigest") || Object.hasOwn(value, "lastAppliedRev");
    exact_keys(value, hasCursor
      ? ["type", "id", "logicalMapId", "incarnationId", "registryDigest", "lastAppliedRev"]
      : ["type", "id", "logicalMapId"], "Hosted recovery request");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    if (id === undefined || logicalMapId === undefined) throw new Error("Hosted recovery request requires non-empty id and logicalMapId.");
    if (!hasCursor) return Object.freeze({ type: "recover", id, logicalMapId });
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const lastAppliedRev = required_revision(value.lastAppliedRev);
    if (incarnationId === undefined || registryDigest === undefined || lastAppliedRev === undefined) throw new Error("Hosted recovery cursor is malformed.");
    return Object.freeze({ type: "recover", id, logicalMapId, cursor: Object.freeze({ incarnationId, registryDigest, lastAppliedRev }) });
  }
  if (value.type === "subscribe" || value.type === "unsubscribe") {
    exact_keys(value, ["type", "library", "path", "registryDigest"], "Hosted subscription request");
    const library = required_string(value.library);
    const registryDigest = required_digest(value.registryDigest);
    if (library === undefined || registryDigest === undefined || !is_live_path(value.path)) throw new Error("Hosted subscription target is malformed.");
    return Object.freeze({ type: value.type, library, path: clone_path(value.path), registryDigest });
  }
  if (value.type === "action") {
    const hasPayload = Object.hasOwn(value, "payload");
    exact_keys(value, hasPayload ? ["type", "id", "name", "payload"] : ["type", "id", "name"], "Hosted action request");
    const id = required_string(value.id);
    const name = required_string(value.name);
    if (id === undefined || name === undefined || (hasPayload && !is_locus_json_value(value.payload))) throw new Error("Hosted action request is malformed.");
    return Object.freeze({ type: "action", id, name, ...(hasPayload ? { payload: value.payload as JsonValue } : {}) });
  }
  throw new Error("Hosted aggregate request type is unknown.");
}

type DecodedServerMessage =
  | Readonly<{ type: "error"; id?: string; message: string }>
  | Readonly<{ type: "ack"; id: string; result?: JsonValue }>
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
  if (value.type === "error") {
    const hasId = Object.hasOwn(value, "id");
    exact_keys(value, hasId ? ["type", "format", "id", "code", "message"] : ["type", "format", "code", "message"], "Hosted aggregate error");
    const message = required_string(value.message);
    if (message === undefined || typeof value.code !== "string" || (hasId && required_string(value.id) === undefined)) throw new Error("Hosted aggregate error is malformed.");
    return Object.freeze({ type: "error", ...(hasId ? { id: value.id as string } : {}), message });
  }
  if (value.type === "ack") {
    const hasResult = Object.hasOwn(value, "result");
    exact_keys(value, hasResult ? ["type", "format", "id", "revision", "result"] : ["type", "format", "id", "revision"], "Hosted aggregate acknowledgement");
    const id = required_string(value.id);
    if (id === undefined || required_revision(value.revision) === undefined || (hasResult && !is_locus_json_value(value.result))) throw new Error("Hosted aggregate acknowledgement is malformed.");
    return Object.freeze({ type: "ack", id, ...(hasResult ? { result: value.result as JsonValue } : {}) });
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

function apply_document_action(
  draft: LocusHostedAggregateDraft,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  identitiesByName: ReadonlyMap<string, object>,
  name: string,
  payload: JsonValue | undefined,
): void {
  const record = exact_record(payload, `Hosted document action ${name}`);
  const libraryName = required_string(record.library);
  const identity = libraryName === undefined ? undefined : identitiesByName.get(libraryName);
  if (libraryName === undefined || identity === undefined) throw new Error("Hosted document action requires a known library.");
  const selected = draft.lib(libraryName);
  if (!("graph" in selected)) throw new Error("Hosted document action library is not a document Library.");
  const target = document_target_for_library(decode_locus_document_target(record.target), aggregate, identity);
  if (target === undefined) throw new Error("Hosted document action target is malformed or belongs to another Library.");
  const payloadWithoutLibrary = { ...record };
  delete payloadWithoutLibrary.library;
  if (name === "document.attrs.set") {
    exact_keys(payloadWithoutLibrary, ["target", "name", "value"], name);
    const attr = decode_locus_document_attribute_name(payloadWithoutLibrary.name);
    const value = attr === undefined ? undefined : decode_locus_document_attribute_value(attr, payloadWithoutLibrary.value);
    if (attr === undefined || value === undefined) throw new Error("Hosted document attribute action is malformed.");
    selected.attrs.set(target, attr, value);
    return;
  }
  if (name === "document.attrs.drop") {
    exact_keys(payloadWithoutLibrary, ["target", "name"], name);
    const attr = decode_locus_document_attribute_name(payloadWithoutLibrary.name);
    if (attr === undefined) throw new Error("Hosted document attribute action is malformed.");
    selected.attrs.drop(target, attr);
    return;
  }
  if (name === "document.attrs.setMany" || name === "document.attrs.replace") {
    exact_keys(payloadWithoutLibrary, ["target", "values"], name);
    const attrs = decode_locus_document_attrs(payloadWithoutLibrary.values);
    if (attrs === undefined) throw new Error("Hosted document attributes are malformed.");
    if (name === "document.attrs.setMany") {
      for (const [attr, value] of Object.entries(attrs)) selected.attrs.set(target, attr, value);
    } else selected.attrs.replace(target, attrs);
    return;
  }
  if (name === "document.attrs.dropMany") {
    exact_keys(payloadWithoutLibrary, ["target", "names"], name);
    if (!Array.isArray(payloadWithoutLibrary.names)) throw new Error("Hosted document attribute names are malformed.");
    for (const rawName of payloadWithoutLibrary.names) {
      const attr = decode_locus_document_attribute_name(rawName);
      if (attr === undefined) throw new Error("Hosted document attribute name is malformed.");
      selected.attrs.drop(target, attr);
    }
    return;
  }
  if (name === "document.attrs.clear") {
    exact_keys(payloadWithoutLibrary, ["target"], name);
    selected.attrs.replace(target, Object.freeze({}));
    return;
  }
  if (name === "document.content.remove") {
    exact_keys(payloadWithoutLibrary, ["target", "index"], name);
    const index = required_revision(payloadWithoutLibrary.index);
    if (index === undefined) throw new Error("Hosted document content index is malformed.");
    selected.content.remove(target, index);
    return;
  }
  if (name === "document.content.move") {
    exact_keys(payloadWithoutLibrary, ["target", "from", "to"], name);
    const from = required_revision(payloadWithoutLibrary.from);
    const to = required_revision(payloadWithoutLibrary.to);
    if (from === undefined || to === undefined || from === to) throw new Error("Hosted document content move is malformed.");
    selected.content.move(target, from, to);
    return;
  }
  if (name === "document.content.replace" || name === "document.content.insert") {
    const contentKey = name === "document.content.replace" ? "replacement" : "content";
    exact_keys(payloadWithoutLibrary, ["target", "index", contentKey], name);
    const index = required_revision(payloadWithoutLibrary.index);
    if (index === undefined) throw new Error("Hosted document content index is malformed.");
    const content = decode_locus_graph_content(payloadWithoutLibrary[contentKey]);
    if (name === "document.content.replace") selected.content.replace(target, index, content);
    else selected.content.insert(target, index, content);
    return;
  }
  throw new Error(`Unknown hosted document action ${name}.`);
}

function document_target_for_library(
  target: LiveMapDocumentTarget | undefined,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  identity: object,
): LiveMapDocumentCommitTarget | undefined {
  if (target === undefined) return undefined;
  if (target.kind === "path") return Object.freeze({
    kind: "path" as const,
    path: validate_document_path(target.path),
  });
  const location = aggregate.resolveQuid(target.quid);
  if (location === undefined || location.library !== identity) return undefined;
  return Object.freeze({
    kind: "path" as const,
    path: validate_document_path(location.path),
    witness: Object.freeze({ quid: target.quid }),
  });
}

function exact_sync_value(value: JsonValue | undefined): Readonly<{ present: boolean; payload: string }> {
  if (value === undefined) return Object.freeze({ present: false, payload: "" });
  const exact = value === null || typeof value !== "object" ? value : parse_json(value);
  return Object.freeze({ present: true, payload: encode_exact_hson_value(exact) });
}

function is_document_action(name: string): boolean {
  return name === "document.attrs.set"
    || name === "document.attrs.drop"
    || name === "document.attrs.setMany"
    || name === "document.attrs.dropMany"
    || name === "document.attrs.clear"
    || name === "document.attrs.replace"
    || name === "document.content.replace"
    || name === "document.content.insert"
    || name === "document.content.remove"
    || name === "document.content.move";
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
